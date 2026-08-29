from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import optuna
from optuna.trial import Trial, TrialState

from app.models import (
    BestTrial,
    CategoricalParameter,
    CreateRun,
    FloatParameter,
    IntParameter,
    NextTrial,
    RunProgress,
    RunStatus,
    TrialFailure,
    TrialResult,
)


@dataclass(slots=True)
class ActiveRun:
    config: CreateRun
    study: optuna.Study
    status: RunStatus = RunStatus.CREATED
    outstanding_trial: Trial | None = None


class OptimisationManager:
    def __init__(self, storage_url: str) -> None:
        self._storage_url = storage_url
        self._runs: dict[str, ActiveRun] = {}
        self._lock = asyncio.Lock()

    async def create_run(self, config: CreateRun) -> RunProgress:
        async with self._lock:
            if config.run_id in self._runs:
                existing = self._runs[config.run_id]
                if existing.config != config:
                    raise ValueError("run_id already exists with a different configuration")
                return self._progress(existing)

            # Optuna v5's default sampler is intentional. For a single-objective study,
            # v5 defaults to the enhanced multivariate TPE sampler with constant liar.
            study = optuna.create_study(
                study_name=config.run_id,
                storage=self._storage_url,
                direction=config.direction.value,
                load_if_exists=True,
            )

            config_json = config.model_dump(mode="json")
            persisted_config = study.user_attrs.get("config")
            if persisted_config is None:
                study.set_user_attr("config", config_json)
            elif persisted_config != config_json:
                raise ValueError(
                    "run_id already exists in persistent storage with a different configuration"
                )

            # This service evaluates one browser trial at a time. If the process was
            # restarted, any persisted RUNNING trial no longer has a live browser
            # evaluator attached to it and must not remain as a zombie trial.
            stale_running = study.get_trials(
                deepcopy=False,
                states=(TrialState.RUNNING,),
            )
            for stale_trial in stale_running:
                study.tell(stale_trial.number, state=TrialState.FAIL)

            status = (
                RunStatus.COMPLETED
                if self._complete_count_for_study(study) >= config.target_trials
                else RunStatus.CREATED
            )
            run = ActiveRun(config=config, study=study, status=status)
            self._runs[config.run_id] = run
            return self._progress(run)

    async def start(self, run_id: str) -> tuple[RunProgress, NextTrial | None]:
        async with self._lock:
            run = self._require(run_id)
            if run.status in {RunStatus.COMPLETED, RunStatus.STOPPED}:
                return self._progress(run), None
            run.status = RunStatus.RUNNING
            return self._progress(run), self._next_trial_locked(run)

    async def next_trial(self, run_id: str) -> NextTrial | None:
        async with self._lock:
            run = self._require(run_id)
            return self._next_trial_locked(run)

    async def submit_result(self, result: TrialResult) -> tuple[RunProgress, NextTrial | None]:
        async with self._lock:
            run = self._require(result.run_id)
            trial = self._require_outstanding(run, result.trial_number)

            try:
                objective = float(result.metrics[run.config.objective_metric])
            except KeyError as exc:
                raise ValueError(
                    f"objective metric {run.config.objective_metric!r} missing from trial metrics"
                ) from exc

            for metric_filter in run.config.filters:
                if metric_filter.metric not in result.metrics:
                    raise ValueError(
                        f"filter metric {metric_filter.metric!r} missing from trial metrics"
                    )
                actual = result.metrics[metric_filter.metric]
                if metric_filter.operator == "lte":
                    violation = actual - metric_filter.value
                else:
                    violation = metric_filter.value - actual
                trial.set_constraint(
                    f"{metric_filter.metric}:{metric_filter.operator}:{metric_filter.value}",
                    violation,
                )

            trial.set_user_attr("metrics", result.metrics)
            if result.duration_ms is not None:
                trial.set_user_attr("duration_ms", result.duration_ms)

            run.study.tell(trial, objective)
            run.outstanding_trial = None

            if self._complete_count(run) >= run.config.target_trials:
                run.status = RunStatus.COMPLETED
                return self._progress(run), None

            if run.status == RunStatus.STOP_REQUESTED:
                run.status = RunStatus.STOPPED
                return self._progress(run), None

            return self._progress(run), self._next_trial_locked(run)

    async def submit_failure(self, failure: TrialFailure) -> tuple[RunProgress, NextTrial | None]:
        async with self._lock:
            run = self._require(failure.run_id)
            trial = self._require_outstanding(run, failure.trial_number)
            trial.set_user_attr("failure_reason", failure.reason)
            run.study.tell(trial, state=TrialState.FAIL)
            run.outstanding_trial = None

            if run.status == RunStatus.STOP_REQUESTED:
                run.status = RunStatus.STOPPED
                return self._progress(run), None

            return self._progress(run), self._next_trial_locked(run)

    async def stop(self, run_id: str) -> RunProgress:
        async with self._lock:
            run = self._require(run_id)
            if run.status not in {RunStatus.RUNNING, RunStatus.STOP_REQUESTED}:
                return self._progress(run)
            if run.outstanding_trial is None:
                run.status = RunStatus.STOPPED
            else:
                run.status = RunStatus.STOP_REQUESTED
            return self._progress(run)

    async def progress(self, run_id: str) -> RunProgress:
        async with self._lock:
            return self._progress(self._require(run_id))

    def _next_trial_locked(self, run: ActiveRun) -> NextTrial | None:
        if run.status != RunStatus.RUNNING:
            return None
        if run.outstanding_trial is not None:
            return NextTrial(
                run_id=run.config.run_id,
                trial_number=run.outstanding_trial.number,
                parameters=dict(run.outstanding_trial.params),
            )
        if self._complete_count(run) >= run.config.target_trials:
            run.status = RunStatus.COMPLETED
            return None

        trial = run.study.ask()
        parameters: dict[str, Any] = {}
        for parameter in run.config.parameters:
            if isinstance(parameter, FloatParameter):
                parameters[parameter.name] = trial.suggest_float(
                    parameter.name,
                    parameter.low,
                    parameter.high,
                    step=parameter.step,
                    log=parameter.log,
                )
            elif isinstance(parameter, IntParameter):
                parameters[parameter.name] = trial.suggest_int(
                    parameter.name,
                    parameter.low,
                    parameter.high,
                    step=parameter.step,
                    log=parameter.log,
                )
            elif isinstance(parameter, CategoricalParameter):
                parameters[parameter.name] = trial.suggest_categorical(
                    parameter.name,
                    parameter.choices,
                )
            else:  # pragma: no cover
                raise TypeError(f"unsupported parameter type: {type(parameter)!r}")

        run.outstanding_trial = trial
        return NextTrial(
            run_id=run.config.run_id,
            trial_number=trial.number,
            parameters=parameters,
        )

    def _progress(self, run: ActiveRun) -> RunProgress:
        return RunProgress(
            run_id=run.config.run_id,
            status=run.status,
            completed_trials=self._complete_count(run),
            target_trials=run.config.target_trials,
            failed_trials=sum(t.state == TrialState.FAIL for t in run.study.trials),
            best=self._best(run),
        )

    @staticmethod
    def _complete_count_for_study(study: optuna.Study) -> int:
        return sum(t.state == TrialState.COMPLETE for t in study.trials)

    @classmethod
    def _complete_count(cls, run: ActiveRun) -> int:
        return cls._complete_count_for_study(run.study)

    @staticmethod
    def _best(run: ActiveRun) -> BestTrial | None:
        # In Optuna v5 best_trial honours native constraints. If there is no feasible
        # completed trial, accessing it can raise ValueError.
        try:
            best = run.study.best_trial
        except ValueError:
            return None
        metrics = best.user_attrs.get("metrics")
        if not isinstance(metrics, dict):
            return None
        return BestTrial(
            trial_number=best.number,
            objective_value=float(best.value),
            parameters=dict(best.params),
            metrics={key: float(value) for key, value in metrics.items()},
            constraints=dict(best.constraints),
        )

    def _require(self, run_id: str) -> ActiveRun:
        try:
            return self._runs[run_id]
        except KeyError as exc:
            raise KeyError(f"unknown run_id: {run_id}") from exc

    @staticmethod
    def _require_outstanding(run: ActiveRun, trial_number: int) -> Trial:
        trial = run.outstanding_trial
        if trial is None or trial.number != trial_number:
            current = None if trial is None else trial.number
            raise ValueError(
                f"trial {trial_number} is not the outstanding trial (current={current})"
            )
        return trial
