from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from decimal import Decimal
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
    RunUpdate,
    SearchParameter,
    TrialFailure,
    TrialResult,
    TrialSummary,
)

ParameterSignature = tuple[tuple[str, str], ...]


@dataclass(slots=True, frozen=True)
class ReusableTrial:
    number: int
    value: float
    metrics: dict[str, float]
    constraints: dict[str, float]
    objective_fallback: str | None


@dataclass(slots=True)
class ActiveRun:
    config: CreateRun
    study: optuna.Study
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    status: RunStatus = RunStatus.CREATED
    outstanding_trial: Trial | None = None
    termination_reason: str | None = None
    search_space_cardinality: int | None = None
    completed_count: int = 0
    failed_count: int = 0
    reused_count: int = 0
    summaries: list[TrialSummary] = field(default_factory=list)
    reusable_by_signature: dict[ParameterSignature, ReusableTrial] = field(default_factory=dict)
    evaluated_signatures: set[ParameterSignature] = field(default_factory=set)
    convergence_best_values: list[float | None] = field(default_factory=list)
    best: BestTrial | None = None


class UnknownRunError(KeyError):
    """The requested optimisation run does not exist."""


class StaleTrialError(ValueError):
    """The browser submitted a result for a trial that is not awaiting a result."""


class OptimisationManager:
    def __init__(self, storage_url: str) -> None:
        self._storage = optuna.storages.RDBStorage(storage_url)
        self._runs: dict[str, ActiveRun] = {}
        self._registry_lock = asyncio.Lock()

    def close(self) -> None:
        self._storage.remove_session()
        self._storage.engine.dispose()

    async def create_run(self, config: CreateRun) -> RunProgress:
        async with self._registry_lock:
            if config.run_id in self._runs:
                existing = self._runs[config.run_id]
                if existing.config != config:
                    raise ValueError("run_id already exists with a different configuration")
                return self._progress(existing)

            # Use Optuna v5's default multivariate TPE sampler with constant liar
            # for single-objective studies.
            study = optuna.create_study(
                study_name=config.run_id,
                storage=self._storage,
                direction=config.direction.value,
                load_if_exists=True,
            )

            self._reconcile_study_config(study, config)

            # Load the persisted study once. Mark interrupted browser trials as
            # failed after a restart, then refresh the snapshot if any changed.
            study_trials = study.get_trials(deepcopy=False)
            stale_running = [trial for trial in study_trials if trial.state == TrialState.RUNNING]
            for stale_trial in stale_running:
                study.tell(stale_trial.number, state=TrialState.FAIL)

            if stale_running:
                study_trials = study.get_trials(deepcopy=False)

            if not study_trials and config.baseline_parameters:
                study.enqueue_trial(
                    config.baseline_parameters,
                    skip_if_exists=True,
                )

            search_space_cardinality = self._finite_search_space_cardinality(
                config.parameters, config.target_trials
            )
            status, termination_reason = self._restored_status(
                study, study_trials, config, search_space_cardinality
            )

            run = ActiveRun(
                config=config,
                study=study,
                status=status,
                termination_reason=termination_reason,
                search_space_cardinality=search_space_cardinality,
            )
            self._rebuild_cache(run, study_trials)
            self._runs[config.run_id] = run
            self._persist_status(run)
            return self._progress(run)

    @staticmethod
    def _reconcile_study_config(study: optuna.Study, config: CreateRun) -> None:
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

    def _restored_status(
        self,
        study: optuna.Study,
        study_trials: list[FrozenTrial],
        config: CreateRun,
        search_space_cardinality: int | None,
    ) -> tuple[RunStatus, str | None]:
        persisted_status = study.user_attrs.get("run_status")
        persisted_reason = study.user_attrs.get("termination_reason")
        completed_trials = sum(trial.state == TrialState.COMPLETE for trial in study_trials)
        unique_evaluated = {
            self._parameter_signature(trial.params)
            for trial in study_trials
            if trial.state == TrialState.COMPLETE
            and isinstance(trial.user_attrs.get("metrics"), dict)
        }

        if completed_trials >= config.target_trials:
            status = RunStatus.COMPLETED
            termination_reason = "target_trials"
        elif persisted_status == RunStatus.COMPLETED.value and persisted_reason in {
            "converged",
            "search_space_exhausted",
        }:
            status = RunStatus.COMPLETED
            termination_reason = str(persisted_reason)
        elif (
            search_space_cardinality is not None
            and len(unique_evaluated) >= search_space_cardinality
        ):
            status = RunStatus.COMPLETED
            termination_reason = "search_space_exhausted"
        elif persisted_status == RunStatus.STOPPED.value:
            status = RunStatus.STOPPED
            termination_reason = "user"
        else:
            # Return interrupted studies as CREATED until the browser resumes them.
            status = RunStatus.CREATED
            termination_reason = None

        return status, termination_reason

    async def start(self, run_id: str) -> tuple[RunProgress, NextTrial | None]:
        async with self._require(run_id).lock:
            run = self._require(run_id)
            if run.status in {RunStatus.COMPLETED, RunStatus.STOPPED}:
                return self._progress(run), None
            self._set_status(run, RunStatus.RUNNING)
            next_trial = self._next_trial_locked(run)
            return self._progress(run), next_trial

    async def submit_result(
        self,
        result: TrialResult,
    ) -> tuple[RunUpdate, NextTrial | None]:
        async with self._require(result.run_id).lock:
            run = self._require(result.run_id)
            trial = self._require_outstanding(run, result.trial_number)
            update_start = len(run.summaries)

            objective, objective_fallback = self._trial_objective(run, trial, result)
            constraints = self._trial_constraints(run, trial, result)

            trial.set_user_attr("metrics", result.metrics)
            if result.duration_ms is not None:
                trial.set_user_attr("duration_ms", result.duration_ms)

            run.study.tell(trial, objective)
            run.outstanding_trial = None
            self._record_completed_trial(
                run,
                trial,
                objective=objective,
                metrics=result.metrics,
                duration_ms=result.duration_ms,
                constraints=constraints,
                objective_fallback=objective_fallback,
            )

            if run.completed_count >= run.config.target_trials:
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="target_trials",
                )
                return self._update(run, update_start), None

            if run.status == RunStatus.STOP_REQUESTED:
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )
                return self._update(run, update_start), None

            if self._should_converge(run):
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="converged",
                )
                return self._update(run, update_start), None

            next_trial = self._next_trial_locked(run)
            return self._update(run, update_start), next_trial

    @staticmethod
    def _trial_objective(
        run: ActiveRun, trial: Trial, result: TrialResult
    ) -> tuple[float, str | None]:
        total_trades = result.metrics.get("totalTrades")
        objective_value = result.metrics.get(run.config.objective_metric)
        objective_fallback: str | None = None

        if objective_value is None:
            if total_trades == 0:
                # Assign no-trade results a poor finite objective so TPE
                # avoids them. Keep them as completed strategy outcomes.
                objective = (
                    -1.0e12 if run.config.direction == ObjectiveDirection.MAXIMIZE else 1.0e12
                )
                objective_fallback = "no_trades"
                trial.set_user_attr("objective_fallback", objective_fallback)
            else:
                raise ValueError(
                    f"objective metric {run.config.objective_metric!r} missing from trial metrics"
                )
        else:
            objective = float(objective_value)

        return objective, objective_fallback

    @staticmethod
    def _trial_constraints(run: ActiveRun, trial: Trial, result: TrialResult) -> dict[str, float]:
        total_trades = result.metrics.get("totalTrades")
        constraints: dict[str, float] = {}
        for metric_filter in run.config.filters:
            actual = result.metrics.get(metric_filter.metric)

            if actual is None:
                if total_trades == 0:
                    # Ratios can be undefined when the strategy makes no trades.
                    violation = 1.0e12
                else:
                    raise ValueError(
                        f"constraint metric {metric_filter.metric!r} missing from trial metrics"
                    )
            elif metric_filter.operator == "lte":
                violation = actual - metric_filter.value
            else:
                violation = metric_filter.value - actual

            constraint_name = (
                f"{metric_filter.metric}:{metric_filter.operator}:{metric_filter.value}"
            )
            constraints[constraint_name] = violation
            trial.set_constraint(
                constraint_name,
                violation,
            )

        return constraints

    async def submit_failure(
        self,
        failure: TrialFailure,
    ) -> tuple[RunUpdate, NextTrial | None]:
        async with self._require(failure.run_id).lock:
            run = self._require(failure.run_id)
            trial = self._require_outstanding(run, failure.trial_number)
            update_start = len(run.summaries)

            trial.set_user_attr("failure_reason", failure.reason)
            run.study.tell(trial, state=TrialState.FAIL)
            run.outstanding_trial = None
            self._record_failed_trial(run, trial, failure.reason)

            if run.status == RunStatus.STOP_REQUESTED:
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )
                return self._update(run, update_start), None

            next_trial = self._next_trial_locked(run)
            return self._update(run, update_start), next_trial

    async def stop(self, run_id: str) -> RunProgress:
        async with self._require(run_id).lock:
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

    async def abort(self, run_id: str, reason: str) -> RunProgress:
        """Force-stop a run and fail any outstanding browser-owned trial."""
        async with self._require(run_id).lock:
            run = self._require(run_id)

            if run.outstanding_trial is not None:
                trial = run.outstanding_trial
                trial.set_user_attr("failure_reason", reason)
                run.study.tell(trial, state=TrialState.FAIL)
                run.outstanding_trial = None
                self._record_failed_trial(run, trial, reason)

            if run.status not in {RunStatus.COMPLETED, RunStatus.STOPPED}:
                self._set_status(
                    run,
                    RunStatus.STOPPED,
                    termination_reason="user",
                )

            return self._progress(run)

    async def progress(self, run_id: str) -> RunProgress:
        async with self._require(run_id).lock:
            return self._progress(self._require(run_id))

    async def delete_run(self, run_id: str) -> None:
        async with self._require(run_id).lock:
            run = self._require(run_id)

            if run.outstanding_trial is not None or run.status in {
                RunStatus.RUNNING,
                RunStatus.STOP_REQUESTED,
            }:
                raise ValueError("cannot delete an active optimisation run")

            async with self._registry_lock:
                optuna.delete_study(
                    study_name=run_id,
                    storage=self._storage,
                )
                self._runs.pop(run_id, None)

    async def analysis(self, run_id: str) -> RunAnalysis:
        async with self._require(run_id).lock:
            run = self._require(run_id)
            completed = run.study.get_trials(
                deepcopy=False,
                states=(TrialState.COMPLETE,),
            )
            feasible = [
                trial
                for trial in completed
                if trial.value is not None and self._is_feasible_trial(trial)
            ]
            completed_count = len(completed)
            direction = run.config.direction.value

        if len(feasible) < 5:
            return RunAnalysis(
                run_id=run_id,
                parameter_importance={},
                parameter_importance_status="insufficient_data",
                completed_trials=completed_count,
            )

        # Calculate PED-ANOVA from a FrozenTrial snapshot outside the run lock
        # and event loop so large studies do not block trial submissions.
        importance, importance_status, importance_error = await asyncio.to_thread(
            self._parameter_importance,
            feasible,
            direction,
        )

        return RunAnalysis(
            run_id=run_id,
            parameter_importance=importance,
            parameter_importance_status=importance_status,
            parameter_importance_error=importance_error,
            completed_trials=completed_count,
        )

    @staticmethod
    def _parameter_importance(
        feasible: list[FrozenTrial],
        direction: str,
    ) -> tuple[dict[str, float], str, str | None]:
        if not any(trial.params for trial in feasible):
            return {}, "not_applicable", None

        try:
            analysis_study = optuna.create_study(
                direction=direction,
            )
            analysis_study.add_trials(feasible)
            # Leaving params unset includes conditional parameters in Optuna 5.
            importance = get_param_importances(
                analysis_study,
                evaluator=PedAnovaImportanceEvaluator(
                    target_quantile=0.2,
                ),
            )
        except (ValueError, RuntimeError) as exc:
            return {}, "failed", str(exc)

        return importance, "available", None

    def _next_trial_locked(self, run: ActiveRun) -> NextTrial | None:
        if run.status != RunStatus.RUNNING:
            return None

        if run.outstanding_trial is not None:
            return NextTrial(
                run_id=run.config.run_id,
                trial_number=run.outstanding_trial.number,
                parameters=dict(run.outstanding_trial.params),
            )

        if run.completed_count >= run.config.target_trials:
            self._set_status(
                run,
                RunStatus.COMPLETED,
                termination_reason="target_trials",
            )
            return None

        if self._search_space_exhausted(run):
            self._set_status(
                run,
                RunStatus.COMPLETED,
                termination_reason="search_space_exhausted",
            )
            return None

        while run.status == RunStatus.RUNNING:
            trial = run.study.ask()
            parameters = self._suggest_parameters(run, trial)

            if not self._reuse_completed_trial(run, trial):
                run.outstanding_trial = trial
                return NextTrial(
                    run_id=run.config.run_id,
                    trial_number=trial.number,
                    parameters=parameters,
                )

            if run.completed_count >= run.config.target_trials:
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="target_trials",
                )
                return None

            if self._search_space_exhausted(run):
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="search_space_exhausted",
                )
                return None

            if self._should_converge(run):
                self._set_status(
                    run,
                    RunStatus.COMPLETED,
                    termination_reason="converged",
                )
                return None

        return None

    def _suggest_parameters(self, run: ActiveRun, trial: Trial) -> dict[str, Any]:
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
        return parameters

    @classmethod
    def _finite_search_space_cardinality(
        cls,
        parameters: list[SearchParameter],
        limit: int,
    ) -> int | None:
        def count_from(
            index: int,
            sampled_parameters: dict[str, Any],
        ) -> int | None:
            if index >= len(parameters):
                return 1

            parameter = parameters[index]
            if not cls._condition_matches(parameter, sampled_parameters):
                return count_from(index + 1, sampled_parameters)

            if isinstance(parameter, CategoricalParameter):
                total = 0
                for choice in parameter.choices:
                    sampled_parameters[parameter.name] = choice
                    branch = count_from(index + 1, sampled_parameters)
                    sampled_parameters.pop(parameter.name, None)

                    if branch is None:
                        return None

                    total += branch
                    if total > limit:
                        return None

                return total

            choices = cls._numeric_cardinality(parameter)
            if choices is None:
                return None

            branch = count_from(index + 1, sampled_parameters)
            if branch is None:
                return None

            total = choices * branch
            return total if total <= limit else None

        return count_from(0, {})

    @staticmethod
    def _numeric_cardinality(parameter: SearchParameter) -> int | None:
        if isinstance(parameter, IntParameter):
            choices = ((parameter.high - parameter.low) // parameter.step) + 1
        elif isinstance(parameter, FloatParameter):
            if parameter.step is None or parameter.log:
                return None

            low = Decimal(str(parameter.low))
            high = Decimal(str(parameter.high))
            step = Decimal(str(parameter.step))
            choices = int((high - low) // step) + 1
        else:  # pragma: no cover
            return None
        return choices

    @staticmethod
    def _parameter_signature(
        parameters: dict[str, Any],
    ) -> ParameterSignature:
        return tuple((name, repr(value)) for name, value in sorted(parameters.items()))

    @classmethod
    def _rebuild_cache(
        cls,
        run: ActiveRun,
        trials: list[FrozenTrial],
    ) -> None:
        for trial in trials:
            if trial.state not in {TrialState.COMPLETE, TrialState.FAIL}:
                continue

            fallback = trial.user_attrs.get("objective_fallback")
            cls._cache_trial(
                run,
                cls._summary_from_frozen(trial),
                has_metrics=isinstance(trial.user_attrs.get("metrics"), dict),
                objective_fallback=str(fallback) if fallback is not None else None,
            )

    @classmethod
    def _cache_trial(
        cls,
        run: ActiveRun,
        summary: TrialSummary,
        *,
        has_metrics: bool = True,
        objective_fallback: str | None = None,
    ) -> None:
        """Apply a settled trial identically for live results and study restoration."""
        run.summaries.append(summary)
        if summary.state == "failed":
            run.failed_count += 1
            return

        run.completed_count += 1
        run.reused_count += summary.reused_from_trial is not None
        objective = summary.objective_value
        if has_metrics:
            signature = cls._parameter_signature(summary.parameters)
            run.evaluated_signatures.add(signature)
            if objective is not None:
                run.reusable_by_signature.setdefault(
                    signature,
                    ReusableTrial(
                        number=summary.trial_number,
                        value=objective,
                        metrics=dict(summary.metrics),
                        constraints=dict(summary.constraints),
                        objective_fallback=objective_fallback,
                    ),
                )

        feasible = all(value <= 0 for value in summary.constraints.values())
        cls._append_convergence_value(run, objective if feasible else None)
        if not has_metrics or not feasible or objective is None:
            return

        current = run.best
        if current is None or (
            objective > current.objective_value
            if run.config.direction == ObjectiveDirection.MAXIMIZE
            else objective < current.objective_value
        ):
            run.best = BestTrial(
                trial_number=summary.trial_number,
                objective_value=objective,
                parameters=summary.parameters,
                metrics=summary.metrics,
                constraints=summary.constraints,
            )

    @staticmethod
    def _summary_from_frozen(
        trial: FrozenTrial,
    ) -> TrialSummary:
        metrics = trial.user_attrs.get("metrics")
        metrics_dict = (
            {key: float(value) for key, value in metrics.items()}
            if isinstance(metrics, dict)
            else {}
        )

        return TrialSummary(
            trial_number=trial.number,
            state=("complete" if trial.state == TrialState.COMPLETE else "failed"),
            objective_value=(float(trial.value) if trial.value is not None else None),
            parameters=dict(trial.params),
            metrics=metrics_dict,
            constraints=dict(trial.constraints),
            failure_reason=trial.user_attrs.get("failure_reason"),
            duration_ms=trial.user_attrs.get("duration_ms"),
            reused_from_trial=trial.user_attrs.get("reused_from_trial"),
        )

    @classmethod
    def _record_completed_trial(
        cls,
        run: ActiveRun,
        trial: Trial,
        *,
        objective: float,
        metrics: dict[str, float],
        duration_ms: int | None,
        constraints: dict[str, float],
        objective_fallback: str | None = None,
        reused_from_trial: int | None = None,
    ) -> None:
        parameters = dict(trial.params)
        cls._cache_trial(
            run,
            TrialSummary(
                trial_number=trial.number,
                state="complete",
                objective_value=objective,
                parameters=parameters,
                metrics=dict(metrics),
                constraints=constraints,
                failure_reason=None,
                duration_ms=duration_ms,
                reused_from_trial=reused_from_trial,
            ),
            objective_fallback=objective_fallback,
        )

    @classmethod
    def _record_failed_trial(
        cls,
        run: ActiveRun,
        trial: Trial,
        reason: str,
    ) -> None:
        cls._cache_trial(
            run,
            TrialSummary(
                trial_number=trial.number,
                state="failed",
                objective_value=None,
                parameters=dict(trial.params),
                metrics={},
                constraints={},
                failure_reason=reason,
                duration_ms=None,
                reused_from_trial=None,
            ),
        )

    @classmethod
    def _search_space_exhausted(
        cls,
        run: ActiveRun,
    ) -> bool:
        cardinality = run.search_space_cardinality
        return cardinality is not None and len(run.evaluated_signatures) >= cardinality

    @classmethod
    def _reuse_completed_trial(
        cls,
        run: ActiveRun,
        trial: Trial,
    ) -> bool:
        duplicate = run.reusable_by_signature.get(cls._parameter_signature(trial.params))
        if duplicate is None:
            return False

        for key, value in duplicate.constraints.items():
            trial.set_constraint(key, value)

        trial.set_user_attr("metrics", duplicate.metrics)
        trial.set_user_attr("reused_from_trial", duplicate.number)

        if duplicate.objective_fallback is not None:
            trial.set_user_attr(
                "objective_fallback",
                duplicate.objective_fallback,
            )

        run.study.tell(trial, duplicate.value)
        cls._record_completed_trial(
            run,
            trial,
            objective=duplicate.value,
            metrics=duplicate.metrics,
            duration_ms=None,
            constraints=duplicate.constraints,
            objective_fallback=duplicate.objective_fallback,
            reused_from_trial=duplicate.number,
        )
        return True

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
            completed_trials=run.completed_count,
            target_trials=run.config.target_trials,
            failed_trials=run.failed_count,
            reused_trials=run.reused_count,
            best=run.best,
            termination_reason=run.termination_reason,
            trials=list(run.summaries),
        )

    def _update(
        self,
        run: ActiveRun,
        from_summary_index: int,
    ) -> RunUpdate:
        return RunUpdate(
            run_id=run.config.run_id,
            status=run.status,
            completed_trials=run.completed_count,
            target_trials=run.config.target_trials,
            failed_trials=run.failed_count,
            reused_trials=run.reused_count,
            best=run.best,
            termination_reason=run.termination_reason,
            trial_updates=run.summaries[from_summary_index:],
        )

    @staticmethod
    def _append_convergence_value(
        run: ActiveRun,
        value: float | None,
    ) -> None:
        previous = run.convergence_best_values[-1] if run.convergence_best_values else None

        if value is None:
            current = previous
        elif previous is None:
            current = value
        elif run.config.direction == ObjectiveDirection.MAXIMIZE:
            current = max(previous, value)
        else:
            current = min(previous, value)

        run.convergence_best_values.append(current)

    def _should_converge(self, run: ActiveRun) -> bool:
        config = run.config.research.convergence
        if not config.enabled:
            return False

        completed = run.convergence_best_values
        required = max(
            config.min_trials,
            config.patience + 1,
        )
        if len(completed) < required:
            return False

        baseline_index = len(completed) - config.patience - 1
        baseline_best = completed[baseline_index]
        current_best = completed[-1]

        if baseline_best is None or current_best is None:
            return False

        if run.config.direction == ObjectiveDirection.MAXIMIZE:
            improvement = current_best - baseline_best
        else:
            improvement = baseline_best - current_best

        scale = max(abs(baseline_best), 1.0)
        improvement_percent = max(0.0, improvement) / scale * 100.0
        return improvement_percent < config.min_improvement_percent

    @staticmethod
    def _is_feasible_trial(trial: FrozenTrial) -> bool:
        return all(value <= 0 for value in trial.constraints.values())

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
            raise UnknownRunError(f"unknown run_id: {run_id}") from exc

    @staticmethod
    def _require_outstanding(run: ActiveRun, trial_number: int) -> Trial:
        trial = run.outstanding_trial
        if trial is None or trial.number != trial_number:
            current = None if trial is None else trial.number
            raise StaleTrialError(
                f"trial {trial_number} is not the outstanding trial (current={current})"
            )
        return trial
