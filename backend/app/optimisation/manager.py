from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import optuna
from optuna.importance import PedAnovaImportanceEvaluator, get_param_importances
from optuna.trial import FrozenTrial, Trial, TrialState

from app.models import (
    BestTrial,
    CategoricalParameter,
    CreateRun,
    FloatParameter,
    IntParameter,
    NextTrial,
    ObjectiveDirection,
    RunAnalysis,
    RunProgress,
    RunStatus,
    SearchParameter,
    TrialFailure,
    TrialResult,
    TrialSummary,
)


@dataclass(slots=True)
class ActiveRun:
    config: CreateRun
    study: optuna.Study
    status: RunStatus = RunStatus.CREATED
    outstanding_trial: Trial | None = None
    termination_reason: str | None = None


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

            # Optuna v5's default sampler is intentional. Single-objective studies
            # use the enhanced multivariate TPE sampler with constant liar.
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
            else:
                try:
                    persisted_model = CreateRun.model_validate(persisted_config)
                except Exception as exc:
                    raise ValueError(
                        "persisted run configuration is incompatible with this version"
                    ) from exc

                if persisted_model != config:
                    raise ValueError(
                        "run_id already exists in persistent storage with a different configuration"
                    )

                if persisted_config != config_json:
                    study.set_user_attr("config", config_json)

            # Browser-evaluated RUNNING trials cannot survive a backend/browser
            # process restart. Mark them failed so the sampler is never blocked by
            # an orphaned external evaluation.
            stale_running = study.get_trials(
                deepcopy=False,
                states=(TrialState.RUNNING,),
            )
            for stale_trial in stale_running:
                study.tell(stale_trial.number, state=TrialState.FAIL)

            if not study.trials and config.baseline_parameters:
                study.enqueue_trial(
                    config.baseline_parameters,
                    skip_if_exists=True,
                )

            persisted_status = study.user_attrs.get("run_status")
            persisted_reason = study.user_attrs.get("termination_reason")
            completed_trials = self._complete_count_for_study(study)

            if completed_trials >= config.target_trials:
                status = RunStatus.COMPLETED
                termination_reason = "target_trials"
            elif (
                persisted_status == RunStatus.COMPLETED.value
                and persisted_reason == "converged"
            ):
                status = RunStatus.COMPLETED
                termination_reason = "converged"
            elif persisted_status == RunStatus.STOPPED.value:
                status = RunStatus.STOPPED
                termination_reason = "user"
            else:
                # A previously RUNNING/STOP_REQUESTED study is resumable after a
                # restart. Expose it as CREATED until the browser explicitly resumes.
                status = RunStatus.CREATED
                termination_reason = None

            run = ActiveRun(
                config=config,
                study=study,
                status=status,
                termination_reason=termination_reason,
            )
            self._runs[config.run_id] = run
            self._persist_status(run)
            return self._progress(run)

    async def start(self, run_id: str) -> tuple[RunProgress, NextTrial | None]:
        async with self._lock:
            run = self._require(run_id)
            if run.status in {RunStatus.COMPLETED, RunStatus.STOPPED}:
                return self._progress(run), None
            self._set_status(run, RunStatus.RUNNING)
            return self._progress(run), self._next_trial_locked(run)

    async def next_trial(self, run_id: str) -> NextTrial | None:
        async with self._lock:
            run = self._require(run_id)
            return self._next_trial_locked(run)

    async def submit_result(self, result: TrialResult) -> tuple[RunProgress, NextTrial | None]:
        async with self._lock:
            run = self._require(result.run_id)
            trial = self._require_outstanding(run, result.trial_number)

            total_trades = result.metrics.get("totalTrades")
            objective_value = result.metrics.get(run.config.objective_metric)

            if objective_value is None:
                if total_trades == 0:
                    # No-trade parameter combinations are valid strategy outcomes,
                    # not browser failures. Give them a deliberately poor finite
                    # objective so TPE learns away from that region.
                    objective = (
                        -1.0e12
                        if run.config.direction == ObjectiveDirection.MAXIMIZE
                        else 1.0e12
                    )
                    trial.set_user_attr("objective_fallback", "no_trades")
                else:
                    raise ValueError(
                        f"objective metric {run.config.objective_metric!r} "
                        "missing from trial metrics"
                    )
            else:
                objective = float(objective_value)

            for metric_filter in run.config.filters:
                actual = result.metrics.get(metric_filter.metric)

                if actual is None:
                    # Missing constraint metrics are treated as infeasible rather
                    # than as an execution failure. This covers valid no-trade
                    # outcomes where TradingView leaves ratios such as PF undefined.
                    violation = 1.0e12
                elif metric_filter.operator == "lte":
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
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="target_trials",
                )
                return self._progress(run), None

            if run.status == RunStatus.STOP_REQUESTED:
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )
                return self._progress(run), None

            if self._should_converge(run):
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="converged",
                )
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
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )
                return self._progress(run), None

            return self._progress(run), self._next_trial_locked(run)

    async def stop(self, run_id: str) -> RunProgress:
        async with self._lock:
            run = self._require(run_id)
            if run.status not in {RunStatus.RUNNING, RunStatus.STOP_REQUESTED}:
                return self._progress(run)

            if run.outstanding_trial is None:
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )
            else:
                self._set_status(run, RunStatus.STOP_REQUESTED)

            return self._progress(run)

    async def progress(self, run_id: str) -> RunProgress:
        async with self._lock:
            return self._progress(self._require(run_id))

    async def analysis(self, run_id: str) -> RunAnalysis:
        async with self._lock:
            run = self._require(run_id)
            completed = run.study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            )

            if len(completed) < 5:
                return RunAnalysis(
                    run_id=run_id,
                    parameter_importance={},
                    completed_trials=len(completed),
                )

            common_parameters = set(completed[0].params)
            for trial in completed[1:]:
                common_parameters.intersection_update(trial.params)

            if not common_parameters:
                importance: dict[str, float] = {}
            else:
                try:
                    importance = get_param_importances(
                        run.study,
                        evaluator=PedAnovaImportanceEvaluator(
                            target_quantile=0.2,
                        ),
                        params=sorted(common_parameters),
                        target=self._importance_target(run),
                    )
                except (ValueError, RuntimeError):
                    importance = {}

            return RunAnalysis(
                run_id=run_id,
                parameter_importance=importance,
                completed_trials=len(completed),
            )

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
            self._set_status(
                run,
                RunStatus.COMPLETED,
                termination_reason="target_trials",
            )
            return None

        trial = run.study.ask()
        parameters: dict[str, Any] = {}

        for parameter in run.config.parameters:
            if not self._condition_matches(parameter, parameters):
                continue

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

    @staticmethod
    def _condition_matches(
        parameter: SearchParameter,
        sampled_parameters: dict[str, Any],
    ) -> bool:
        condition = parameter.condition
        if condition is None:
            return True

        if condition.parameter not in sampled_parameters:
            return False

        actual = sampled_parameters[condition.parameter]
        return any(actual == expected for expected in condition.values)

    def _progress(self, run: ActiveRun) -> RunProgress:
        return RunProgress(
            run_id=run.config.run_id,
            status=run.status,
            completed_trials=self._complete_count(run),
            target_trials=run.config.target_trials,
            failed_trials=sum(t.state == TrialState.FAIL for t in run.study.trials),
            best=self._best(run),
            termination_reason=run.termination_reason,
            trials=self._trial_summaries(run),
        )

    @staticmethod
    def _complete_count_for_study(study: optuna.Study) -> int:
        return sum(t.state == TrialState.COMPLETE for t in study.trials)

    @classmethod
    def _complete_count(cls, run: ActiveRun) -> int:
        return cls._complete_count_for_study(run.study)

    @staticmethod
    def _trial_summaries(run: ActiveRun) -> list[TrialSummary]:
        summaries: list[TrialSummary] = []

        for trial in run.study.trials:
            if trial.state not in {TrialState.COMPLETE, TrialState.FAIL}:
                continue

            metrics = trial.user_attrs.get("metrics")
            metrics_dict = (
                {key: float(value) for key, value in metrics.items()}
                if isinstance(metrics, dict)
                else {}
            )

            summaries.append(
                TrialSummary(
                    trial_number=trial.number,
                    state="complete"
                    if trial.state == TrialState.COMPLETE
                    else "failed",
                    objective_value=float(trial.value)
                    if trial.value is not None
                    else None,
                    parameters=dict(trial.params),
                    metrics=metrics_dict,
                    constraints=dict(trial.constraints),
                    failure_reason=trial.user_attrs.get("failure_reason"),
                    duration_ms=trial.user_attrs.get("duration_ms"),
                )
            )

        return summaries

    @staticmethod
    def _best(run: ActiveRun) -> BestTrial | None:
        # Optuna v5 best_trial honours native constraints. If no feasible
        # completed trial exists, accessing it raises ValueError.
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

    def _should_converge(self, run: ActiveRun) -> bool:
        config = run.config.research.convergence
        if not config.enabled:
            return False

        completed = sorted(
            run.study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            ),
            key=lambda trial: trial.number,
        )

        required = max(
            config.min_trials,
            config.patience + 1,
        )
        if len(completed) < required:
            return False

        baseline_trials = completed[: -config.patience]
        baseline_values = [
            float(trial.value)
            for trial in baseline_trials
            if trial.value is not None
            and self._is_feasible_trial(trial)
        ]
        current_values = [
            float(trial.value)
            for trial in completed
            if trial.value is not None
            and self._is_feasible_trial(trial)
        ]

        if not baseline_values or not current_values:
            return False

        if run.config.direction == ObjectiveDirection.MAXIMIZE:
            baseline_best = max(baseline_values)
            current_best = max(current_values)
            improvement = current_best - baseline_best
        else:
            baseline_best = min(baseline_values)
            current_best = min(current_values)
            improvement = baseline_best - current_best

        scale = max(abs(baseline_best), 1.0)
        improvement_percent = max(0.0, improvement) / scale * 100.0
        return improvement_percent < config.min_improvement_percent

    @staticmethod
    def _is_feasible_trial(trial: FrozenTrial) -> bool:
        return all(value <= 0 for value in trial.constraints.values())

    def _importance_target(self, run: ActiveRun):
        complete = run.study.get_trials(
            deepcopy=False,
            states=(TrialState.COMPLETE,),
        )
        feasible_values = [
            float(trial.value)
            for trial in complete
            if trial.value is not None
            and self._is_feasible_trial(trial)
        ]

        if feasible_values:
            if run.config.direction == ObjectiveDirection.MAXIMIZE:
                worst = min(feasible_values)
                penalty = worst - max(abs(worst) * 0.1, 1.0)
            else:
                worst = max(feasible_values)
                penalty = worst + max(abs(worst) * 0.1, 1.0)
        else:
            penalty = 0.0

        def target(trial: FrozenTrial) -> float:
            if (
                trial.value is None
                or not self._is_feasible_trial(trial)
            ):
                return penalty
            return float(trial.value)

        return target

    def _set_status(
        self,
        run: ActiveRun,
        status: RunStatus,
        *,
        termination_reason: str | None = None,
    ) -> None:
        run.status = status
        if termination_reason is not None:
            run.termination_reason = termination_reason
        self._persist_status(run)

    @staticmethod
    def _persist_status(run: ActiveRun) -> None:
        run.study.set_user_attr("run_status", run.status.value)
        if run.termination_reason is not None:
            run.study.set_user_attr(
                "termination_reason",
                run.termination_reason,
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
