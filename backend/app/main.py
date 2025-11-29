from __future__ import annotations

import asyncio
import logging
import os
import time
from importlib import import_module
from typing import TypedDict, cast

import optuna
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from optuna.distributions import FloatDistribution, IntDistribution
from optuna.samplers import BaseSampler, TPESampler

from .schemas import (
    METRIC_INFO,
    FilterComparator,
    MessageType,
    MetricInfo,
    OptimisationConfig,
    OptimisationInterrupted,
    StartMessage,
    StopMessage,
    StrategyMetric,
    StrategyParameterType,
    TrialResultMessage,
    TrialResultPayload,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def _read_allowed_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["http://localhost:8000"]


middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=_read_allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
]

app = FastAPI(title="TV Optimiser Backend", version="0.1.0", middleware=middleware)


@app.get("/health")
def read_health():
    return {"status": "ok"}


@app.post("/config/preview")
def preview_config(config: OptimisationConfig):
    enabled_count = sum(p.enabled for p in config.params)
    if not enabled_count:
        raise HTTPException(
            status_code=400, detail="No parameters selected for optimisation."
        )
    return {"parameters": enabled_count, "trials": config.settings.trials}


@app.websocket("/optimise")
async def optimise_ws(websocket: WebSocket):
    session = OptimisationSession(websocket)
    await session.run()


# Score assigned to trials that fail filters or lack required metrics.
# Large negative value ensures these trials are never selected as best.
PENALTY_SCORE = -1e9
AUTO_SAMPLER_PACKAGE = "samplers/auto_sampler"
AUTO_SAMPLER_SYSTEM_ATTR = "auto:sampler"

TrialParams = dict[str, float | int]


class BestSnapshot(TypedDict):
    metric: float
    trial: int
    params: TrialParams
    metrics: dict[str, float]


class TrialEvaluation(TypedDict):
    """Result of evaluating a single trial against filters."""

    metric_value: float | None
    filters_passed: bool
    filter_reasons: list[str]
    objective: float


def _format_metric_value(value: float) -> str:
    if abs(value) >= 1_000 or (0 < abs(value) < 0.01):
        return f"{value:.3g}"
    formatted = f"{value:.2f}".rstrip("0").rstrip(".")
    return formatted or "0"


def _build_tpe_sampler(seed: int | None) -> TPESampler:
    return TPESampler(multivariate=True, constant_liar=True, seed=seed)


def _get_metric_info(metric: StrategyMetric) -> MetricInfo:
    """Look up metric info with fallback for unknown metrics."""
    return METRIC_INFO.get(metric, MetricInfo(metric.value, metric.value))


class OptimisationSession:
    """Manages a single WebSocket-based optimisation session."""

    def __init__(self, websocket: WebSocket):
        self.websocket: WebSocket = websocket
        self.config: OptimisationConfig | None = None
        self.stop_requested: bool = False
        self.completed: int = 0
        self.best_snapshot: BestSnapshot | None = None
        self.storage_url: str | None = os.getenv("OPTUNA_STORAGE")
        self.sampler_choice: str = os.getenv("OPTUNA_SAMPLER", "auto").strip().lower()
        seed_str = os.getenv("OPTUNA_SAMPLER_SEED", "").strip()
        self.sampler_seed: int | None = int(seed_str) if seed_str.isdigit() else None

    @property
    def _config(self) -> OptimisationConfig:
        """Returns config with a runtime guard, replacing assertions."""
        if self.config is None:
            raise RuntimeError("Optimisation started without configuration")
        return self.config

    async def run(self) -> None:
        """Main entry point: accept connection, receive config, run optimisation."""
        await self.websocket.accept()
        logger.info("WebSocket client connected")
        try:
            start_message = await self._expect_start_message()
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected before sending start message")
            return
        except ValueError as exc:
            await self.websocket.send_json(
                {MessageType.TYPE: MessageType.ERROR, "message": str(exc)}
            )
            await self.websocket.close()
            return

        self.config = start_message.config
        await self.websocket.send_json(
            {MessageType.TYPE: MessageType.STATUS, "message": "Configuration received"}
        )

        try:
            await self._optimise()
        except WebSocketDisconnect:
            logger.info("Client disconnected mid optimisation")
        finally:
            await self._send_completion()

    async def _optimise(self) -> None:
        """Core optimisation loop using Optuna's ask/tell interface."""
        distributions = self._build_distributions(self._config)
        if not distributions:
            await self._safe_send(
                {
                    MessageType.TYPE: MessageType.ERROR,
                    "message": "No numerical parameters available for optimisation.",
                }
            )
            return

        study = await self._create_study(self._config.strategy_id)
        total_trials = self._config.settings.trials

        while self.completed < total_trials and not self.stop_requested:
            trial, params = await self._request_next_trial(study, distributions)
            if trial is None:
                break

            try:
                result = await self._wait_for_trial_result(trial.number)
            except OptimisationInterrupted:
                break

            evaluation = self._evaluate_trial(result.payload)
            self._update_best_snapshot(trial, params, result.payload, evaluation)
            _ = await asyncio.to_thread(study.tell, trial, evaluation["objective"])
            self.completed += 1

            await self._send_trial_complete(
                trial, params, result.payload, evaluation, total_trials
            )

        logger.info(
            "Optimisation loop finished: completed=%s, stop=%s",
            self.completed,
            self.stop_requested,
        )

    async def _request_next_trial(
        self,
        study: optuna.study.Study,
        distributions: dict[str, optuna.distributions.BaseDistribution],
    ) -> tuple[optuna.trial.Trial | None, TrialParams]:
        """Ask Optuna for the next trial and send params to client."""
        try:
            trial = await asyncio.to_thread(study.ask, distributions)
            # Log AutoSampler's choice if available
            sampler_name = trial.system_attrs.get(AUTO_SAMPLER_SYSTEM_ATTR)
            if isinstance(sampler_name, str) and sampler_name:
                logger.info(
                    "AutoSampler selected %s for trial #%s", sampler_name, trial.number
                )
        except WebSocketDisconnect:
            raise
        except Exception as exc:
            logger.exception("Optuna failed to generate a new trial: %s", exc)
            await self._safe_send(
                {
                    MessageType.TYPE: MessageType.ERROR,
                    "message": "Failed to generate next trial.",
                }
            )
            return None, {}

        params = self._pythonise_params(trial, distributions)
        await self._safe_send(
            {
                MessageType.TYPE: MessageType.TRIAL_REQUEST,
                "trial": trial.number,
                "params": params,
            }
        )
        return trial, params

    def _evaluate_trial(self, payload: TrialResultPayload) -> TrialEvaluation:
        """Evaluate trial metrics and filters once, returning all results."""
        metric_value = self._extract_metric_value(payload)
        filters_passed, filter_reasons = self._evaluate_filters(payload)

        if metric_value is None:
            metric_info = _get_metric_info(self._config.settings.metric)
            return {
                "metric_value": None,
                "filters_passed": False,
                "filter_reasons": [f"{metric_info.label} unavailable for this trial"],
                "objective": PENALTY_SCORE,
            }

        objective = metric_value if filters_passed else PENALTY_SCORE
        return {
            "metric_value": metric_value,
            "filters_passed": filters_passed,
            "filter_reasons": filter_reasons,
            "objective": objective,
        }

    def _update_best_snapshot(
        self,
        trial: optuna.trial.Trial,
        params: TrialParams,
        payload: TrialResultPayload,
        evaluation: TrialEvaluation,
    ) -> None:
        """Update best snapshot if this trial is the new best."""
        metric_value = evaluation["metric_value"]
        if not evaluation["filters_passed"] or metric_value is None:
            return
        if not self.best_snapshot or metric_value > self.best_snapshot["metric"]:
            self.best_snapshot = {
                "metric": metric_value,
                "trial": trial.number,
                "params": params,
                "metrics": payload.metrics,
            }

    async def _send_trial_complete(
        self,
        trial: optuna.trial.Trial,
        params: TrialParams,
        payload: TrialResultPayload,
        evaluation: TrialEvaluation,
        total_trials: int,
    ) -> None:
        """Send trial completion message with pre-computed evaluation results."""
        await self._safe_send(
            {
                MessageType.TYPE: MessageType.TRIAL_COMPLETE,
                "trial": trial.number,
                "params": params,
                "metrics": payload.metrics,
                "passedFilters": evaluation["filters_passed"],
                "filterReasons": evaluation["filter_reasons"] or None,
                "objective": evaluation["objective"],
                "progress": {"completed": self.completed, "total": total_trials},
                "best": self.best_snapshot,
            }
        )

    async def _send_completion(self) -> None:
        """Send session completion message and close connection."""
        reason = "stopped" if self.stop_requested else "finished"
        await self._safe_send(
            {
                MessageType.TYPE: MessageType.COMPLETE,
                "reason": reason,
                "best": self.best_snapshot,
            }
        )
        try:
            await self.websocket.close()
        except RuntimeError:
            pass

    async def _expect_start_message(self) -> StartMessage:
        data = await self._receive_json_object()
        msg_type = cast(str | None, data.get(MessageType.TYPE))
        if msg_type != MessageType.START:
            raise ValueError("Expected 'start' message")
        return StartMessage.model_validate(data)

    async def _wait_for_trial_result(self, trial_number: int) -> TrialResultMessage:
        """Block until matching trial result or stop signal received."""
        while True:
            try:
                message = await self._receive_message()
            except WebSocketDisconnect:
                raise OptimisationInterrupted from None
            if isinstance(message, TrialResultMessage):
                if message.trial == trial_number:
                    return message
                logger.warning(
                    "Received out-of-sync trial result: expected=%s got=%s",
                    trial_number,
                    message.trial,
                )
            else:  # StopMessage
                self.stop_requested = True
                raise OptimisationInterrupted

    async def _receive_message(self) -> TrialResultMessage | StopMessage:
        """Receive and parse the next message (trial-result or stop only)."""
        data = await self._receive_json_object()
        msg_type = cast(str | None, data.get(MessageType.TYPE))
        if msg_type == MessageType.TRIAL_RESULT:
            return TrialResultMessage.model_validate(data)
        if msg_type == MessageType.STOP:
            self.stop_requested = True
            return StopMessage.model_validate(data)
        if msg_type == MessageType.START:
            raise ValueError("Start message already received.")
        raise ValueError(f"Unknown message type: {msg_type}")

    async def _receive_json_object(self) -> dict[str, object]:
        try:
            raw_payload = cast(object, await self.websocket.receive_json())
        except WebSocketDisconnect:
            self.stop_requested = True
            raise
        if not isinstance(raw_payload, dict):
            raise ValueError("WebSocket payload must be a JSON object")
        return cast(dict[str, object], raw_payload)

    def _extract_metric_value(self, payload: TrialResultPayload) -> float | None:
        """Extract the target metric value from trial results."""
        metric_info = _get_metric_info(self._config.settings.metric)
        value = payload.metrics.get(metric_info.property_key) or payload.metrics.get(
            self._config.settings.metric.value
        )
        if value is None:
            logger.debug(
                "Metric '%s' missing; available keys=%s",
                metric_info.property_key,
                list(payload.metrics.keys()),
            )
        return value

    def _evaluate_filters(self, payload: TrialResultPayload) -> tuple[bool, list[str]]:
        """Check all configured filters against trial metrics."""
        reasons: list[str] = []
        for flt in self._config.settings.filters:
            info = _get_metric_info(flt.metric)
            metric_value = payload.metrics.get(info.property_key)
            if metric_value is None:
                reasons.append(f"{info.label} unavailable for this trial")
                continue
            if not self._compare(metric_value, flt.value, flt.comparator):
                formatted_value = _format_metric_value(metric_value)
                formatted_target = _format_metric_value(flt.value)
                reasons.append(
                    f"{info.label} ({formatted_value}) fails {flt.comparator.value} {formatted_target}"
                )
        return not reasons, reasons

    @staticmethod
    def _compare(left: float, right: float, comparator: FilterComparator) -> bool:
        match comparator:
            case FilterComparator.GTE:
                return left >= right
            case FilterComparator.LTE:
                return left <= right
            case FilterComparator.GT:
                return left > right
            case FilterComparator.LT:
                return left < right
            case _:
                return left == right

    def _build_distributions(
        self, config: OptimisationConfig
    ) -> dict[str, optuna.distributions.BaseDistribution]:
        distributions: dict[str, optuna.distributions.BaseDistribution] = {}
        for param in config.params:
            if not param.enabled:
                continue
            match param.type:
                case StrategyParameterType.INT:
                    distributions[param.param_id] = IntDistribution(
                        low=int(param.range.min),
                        high=int(param.range.max),
                        step=int(param.range.step or 1),
                    )
                case StrategyParameterType.FLOAT:
                    distributions[param.param_id] = FloatDistribution(
                        low=param.range.min,
                        high=param.range.max,
                        step=param.range.step,
                    )
                case _:
                    logger.info("Skipping unsupported parameter type %s", param.type)
        return distributions

    async def _create_study(self, strategy_id: str) -> optuna.study.Study:
        study_name = f"{strategy_id}-{int(time.time())}"
        sampler = self._build_sampler()
        return await asyncio.to_thread(
            optuna.create_study,
            direction="maximize",
            sampler=sampler,
            study_name=study_name,
            storage=self.storage_url,
            load_if_exists=False,
        )

    def _build_sampler(self) -> BaseSampler:
        """Build sampler based on configuration. Prefers AutoSampler, falls back to TPE."""
        if self.sampler_choice == "tpe":
            return _build_tpe_sampler(self.sampler_seed)

        if self.sampler_choice != "auto":
            logger.warning(
                "Unknown OPTUNA_SAMPLER '%s'; defaulting to AutoSampler",
                self.sampler_choice,
            )

        try:
            optunahub = import_module("optunahub")
            package = optunahub.load_module(package=AUTO_SAMPLER_PACKAGE)  # pyright: ignore[reportAny]
            logger.info(
                "Loaded AutoSampler from OptunaHub package '%s'", AUTO_SAMPLER_PACKAGE
            )
            sampler: BaseSampler = package.AutoSampler()  # pyright: ignore[reportAny]
            return sampler
        except Exception as exc:
            logger.warning(
                "AutoSampler unavailable (%s); falling back to TPESampler", exc
            )
            return _build_tpe_sampler(self.sampler_seed)

    def _pythonise_params(
        self,
        trial: optuna.trial.Trial,
        distributions: dict[str, optuna.distributions.BaseDistribution],
    ) -> TrialParams:
        return {name: cast(float | int, trial.params[name]) for name in distributions}

    async def _safe_send(self, payload: dict[str, object]) -> None:
        try:
            await self.websocket.send_json(payload)
        except (RuntimeError, WebSocketDisconnect) as exc:
            logger.warning("Unable to send message: %s", exc)
