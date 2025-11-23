from __future__ import annotations

import asyncio
import logging
from typing import TypedDict

import optuna
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from optuna.distributions import FloatDistribution, IntDistribution
from optuna.samplers import TPESampler

from .schemas import (
    FilterComparator,
    MessageType,
    OptimisationConfig,
    StartMessage,
    StopMessage,
    StrategyMetric,
    StrategyParameterType,
    TrialResultMessage,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="TV Optimiser Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def read_health():
    return {"status": "ok"}


PENALTY_SCORE = -1e9
TrialParams = dict[str, float | int]


class BestSnapshot(TypedDict):
    metric: float
    trial: int
    params: TrialParams
    metrics: dict[str, float]


class OptimisationSession:
    def __init__(self, websocket: WebSocket):
        self.websocket: WebSocket = websocket
        self.config: OptimisationConfig | None = None
        self.stop_requested: bool = False
        self.completed: int = 0
        self.best_snapshot: BestSnapshot | None = None

    async def run(self) -> None:
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
        distributions = self._build_distributions(self.config)
        if not distributions:
            await self._safe_send(
                {
                    MessageType.TYPE: MessageType.ERROR,
                    "message": "No numerical parameters available for optimisation.",
                }
            )
            return

        study = optuna.create_study(
            direction="maximize",
            sampler=TPESampler(multivariate=True, constant_liar=True),
        )
        total_trials = self.config.settings.trials

        while self.completed < total_trials and not self.stop_requested:
            trial = study.ask(distributions)
            params = {name: trial.params[name] for name in distributions}

            await self._safe_send(
                {
                    MessageType.TYPE: MessageType.TRIAL_REQUEST,
                    "trial": trial.number,
                    "params": params,
                }
            )

            try:
                result = await self._wait_for_trial_result(trial.number)
            except WebSocketDisconnect:
                break

            metric_value = self._extract_metric_value(result.payload)
            filters_passed = self._evaluate_filters(result.payload)

            if metric_value is not None and filters_passed:
                objective = metric_value
                if not self.best_snapshot or metric_value > self.best_snapshot["metric"]:
                    self.best_snapshot = {
                        "metric": metric_value,
                        "trial": trial.number,
                        "params": params,
                        "metrics": result.payload.metrics,
                    }
            else:
                objective = PENALTY_SCORE

            study.tell(trial, objective)
            self.completed += 1

            await self._safe_send(
                {
                    MessageType.TYPE: MessageType.TRIAL_COMPLETE,
                    "trial": trial.number,
                    "params": params,
                    "metrics": result.payload.metrics,
                    "passedFilters": filters_passed,
                    "objective": objective,
                    "progress": {"completed": self.completed, "total": total_trials},
                    "best": self.best_snapshot,
                }
            )

    def _build_distributions(
        self, config: OptimisationConfig
    ) -> dict[str, optuna.distributions.BaseDistribution]:
        distributions: dict[str, optuna.distributions.BaseDistribution] = {}
        for param in config.params:
            if not param.enabled:
                continue
            if param.type == StrategyParameterType.INT:
                distributions[param.param_id] = IntDistribution(
                    low=int(param.range.min),
                    high=int(param.range.max),
                    step=int(param.range.step or 1),
                )
            elif param.type == StrategyParameterType.FLOAT:
                distributions[param.param_id] = FloatDistribution(
                    low=param.range.min,
                    high=param.range.max,
                    step=param.range.step,
                )
        return distributions

    def _extract_metric_value(self, payload) -> float | None:
        metric = self.config.settings.metric
        value = payload.metrics.get(metric.value)
        return value if isinstance(value, (int, float)) else None

    def _evaluate_filters(self, payload) -> bool:
        for flt in self.config.settings.filters:
            metric_value = payload.metrics.get(flt.metric.value)
            if metric_value is None:
                return False
            if not self._compare(metric_value, flt.value, flt.comparator):
                return False
        return True

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

    async def _expect_start_message(self) -> StartMessage:
        data = await self.websocket.receive_json()
        msg_type = data.get(MessageType.TYPE)
        if msg_type != MessageType.START:
            raise ValueError("Expected 'start' message")
        return StartMessage.model_validate(data)

    async def _wait_for_trial_result(self, trial_number: int) -> TrialResultMessage:
        while True:
            try:
                message = await self.websocket.receive_json()
            except WebSocketDisconnect:
                raise
            msg_type = message.get(MessageType.TYPE)
            if msg_type == MessageType.TRIAL_RESULT:
                result = TrialResultMessage.model_validate(message)
                if result.trial == trial_number:
                    return result
            elif msg_type == MessageType.STOP:
                self.stop_requested = True
                raise WebSocketDisconnect

    async def _send_completion(self) -> None:
        reason = "stopped" if self.stop_requested else "finished"
        await self._safe_send(
            {
                MessageType.TYPE: "complete",
                "reason": reason,
                "best": self.best_snapshot,
            }
        )
        try:
            await self.websocket.close()
        except RuntimeError:
            pass

    async def _safe_send(self, payload: dict) -> None:
        try:
            await self.websocket.send_json(payload)
        except (RuntimeError, WebSocketDisconnect) as exc:
            logger.warning("Unable to send message: %s", exc)


@app.websocket("/optimise")
async def optimise_ws(websocket: WebSocket):
    session = OptimisationSession(websocket)
    await session.run()

