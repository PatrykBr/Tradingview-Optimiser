from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Primitive = str | int | float | bool


class ObjectiveDirection(StrEnum):
    MAXIMIZE = "maximize"
    MINIMIZE = "minimize"


class RunStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    STOP_REQUESTED = "stop_requested"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"


class ParameterCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parameter: str
    values: list[Primitive] = Field(min_length=1)


class FloatParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["float"]
    name: str
    low: float
    high: float
    step: float | None = None
    log: bool = False
    condition: ParameterCondition | None = None

    @model_validator(mode="after")
    def validate_range(self) -> FloatParameter:
        if self.low >= self.high:
            raise ValueError("low must be less than high")
        if self.step is not None and self.step <= 0:
            raise ValueError("step must be positive")
        if self.log and self.low <= 0:
            raise ValueError("log-scaled parameters require low > 0")
        if self.log and self.step is not None:
            raise ValueError("Optuna does not allow step together with log=True")
        return self


class IntParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["int"]
    name: str
    low: int
    high: int
    step: int = 1
    log: bool = False
    condition: ParameterCondition | None = None

    @model_validator(mode="after")
    def validate_range(self) -> IntParameter:
        if self.low >= self.high:
            raise ValueError("low must be less than high")
        if self.step <= 0:
            raise ValueError("step must be positive")
        if self.log and self.low <= 0:
            raise ValueError("log-scaled parameters require low > 0")
        if self.log and self.step != 1:
            raise ValueError("Optuna requires step=1 for log-scaled integer parameters")
        return self


class CategoricalParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["categorical"]
    name: str
    choices: list[Primitive]
    condition: ParameterCondition | None = None

    @model_validator(mode="after")
    def validate_choices(self) -> CategoricalParameter:
        if len(self.choices) < 2:
            raise ValueError("categorical parameters need at least two choices")
        return self


SearchParameter = Annotated[
    FloatParameter | IntParameter | CategoricalParameter,
    Field(discriminator="type"),
]


class MetricFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric: str
    operator: Literal["lte", "gte"]
    value: float


class BacktestRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["deep"]
    start_date: str
    end_date: str

    @model_validator(mode="after")
    def validate_dates(self) -> BacktestRange:
        try:
            start = date.fromisoformat(self.start_date)
            end = date.fromisoformat(self.end_date)
        except ValueError as exc:
            raise ValueError("backtest dates must use YYYY-MM-DD") from exc

        if start >= end:
            raise ValueError("backtest start date must be before end date")
        return self


class ConvergenceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    min_trials: int = Field(default=100, ge=5, le=100_000)
    patience: int = Field(default=100, ge=5, le=100_000)
    min_improvement_percent: float = Field(default=1.0, ge=0, le=100)


class RobustnessConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    full_range: BacktestRange | None = None
    validation_fraction: float = Field(default=0.3, ge=0.1, le=0.5)
    folds: int = Field(default=3, ge=1, le=10)
    top_candidates: int = Field(default=5, ge=1, le=20)


class StabilityConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    perturbation_percent: float = Field(default=5.0, ge=0.1, le=25)


class WalkForwardConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    full_range: BacktestRange | None = None
    folds: int = Field(default=3, ge=2, le=8)
    trials_per_fold: int = Field(default=100, ge=5, le=10_000)
    initial_training_fraction: float = Field(default=0.5, ge=0.3, le=0.8)


class MonteCarloConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    simulations: int = Field(default=5_000, ge=500, le=50_000)
    confidence: float = Field(default=0.9, ge=0.5, le=0.99)


class ResearchConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    convergence: ConvergenceConfig = Field(default_factory=ConvergenceConfig)
    robustness: RobustnessConfig = Field(default_factory=RobustnessConfig)
    stability: StabilityConfig = Field(default_factory=StabilityConfig)
    walk_forward: WalkForwardConfig = Field(default_factory=WalkForwardConfig)
    monte_carlo: MonteCarloConfig = Field(default_factory=MonteCarloConfig)


class ChartContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str
    timeframe: str
    strategy_name: str
    strategy_signature: str = Field(min_length=1, max_length=256)
    strategy_settings_signature: str | None = Field(
        default=None,
        min_length=1,
        max_length=256,
    )


class CreateRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=8, max_length=128)
    objective_metric: str
    direction: ObjectiveDirection
    target_trials: int = Field(ge=1, le=100_000)
    parameters: list[SearchParameter] = Field(min_length=1, max_length=100)
    filters: list[MetricFilter] = Field(default_factory=list, max_length=50)
    chart: ChartContext
    backtest_range: BacktestRange | None = None
    baseline_parameters: dict[str, Primitive] = Field(default_factory=dict)
    research: ResearchConfig = Field(default_factory=ResearchConfig)

    @model_validator(mode="after")
    def validate_search_space(self) -> CreateRun:
        names = [parameter.name for parameter in self.parameters]
        if len(names) != len(set(names)):
            raise ValueError("parameter names must be unique")

        by_name: dict[str, SearchParameter] = {
            parameter.name: parameter
            for parameter in self.parameters
        }

        for parameter in self.parameters:
            if parameter.condition is None:
                continue

            parent_name = parameter.condition.parameter
            if parent_name == parameter.name:
                raise ValueError(
                    f"conditional parameter {parameter.name!r} cannot depend on itself"
                )

            parent = by_name.get(parent_name)
            if parent is None:
                raise ValueError(
                    f"conditional parameter {parameter.name!r} depends on "
                    f"unknown parameter {parent_name!r}"
                )

            if not isinstance(parent, CategoricalParameter):
                raise ValueError(
                    f"conditional parameter {parameter.name!r} must depend on "
                    "a categorical parameter"
                )

            invalid = [
                value
                for value in parameter.condition.values
                if value not in parent.choices
            ]
            if invalid:
                raise ValueError(
                    f"condition for {parameter.name!r} contains values "
                    f"outside parent choices: {invalid!r}"
                )

        visiting: set[str] = set()
        visited: set[str] = set()
        ordered: list[SearchParameter] = []

        def visit(name: str) -> None:
            if name in visited:
                return
            if name in visiting:
                raise ValueError("conditional parameter dependencies contain a cycle")

            parameter = by_name[name]
            visiting.add(name)

            if parameter.condition is not None:
                visit(parameter.condition.parameter)

            visiting.remove(name)
            visited.add(name)
            ordered.append(parameter)

        for parameter in self.parameters:
            visit(parameter.name)

        self.parameters = ordered

        unknown_baseline = set(self.baseline_parameters) - set(names)
        if unknown_baseline:
            raise ValueError(
                "baseline contains parameters outside the search space: "
                f"{sorted(unknown_baseline)!r}"
            )

        convergence = self.research.convergence
        if convergence.enabled:
            if convergence.min_trials > self.target_trials:
                raise ValueError("convergence min_trials cannot exceed target_trials")
            if convergence.patience > self.target_trials:
                raise ValueError("convergence patience cannot exceed target_trials")

        robustness = self.research.robustness
        if robustness.enabled and robustness.full_range is None:
            raise ValueError("robustness validation requires a full Deep Backtesting range")

        if (
            self.research.walk_forward.enabled
            and self.research.walk_forward.full_range is None
        ):
            raise ValueError("walk-forward validation requires a full Deep Backtesting range")

        return self


class TrialResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    trial_number: int = Field(ge=0)
    metrics: dict[str, float]
    duration_ms: int | None = Field(default=None, ge=0)


class TrialFailure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    trial_number: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2_000)


class NextTrial(BaseModel):
    run_id: str
    trial_number: int
    parameters: dict[str, Any]


class BestTrial(BaseModel):
    trial_number: int
    objective_value: float
    parameters: dict[str, Any]
    metrics: dict[str, float]
    constraints: dict[str, float]


class TrialSummary(BaseModel):
    trial_number: int
    state: Literal["complete", "failed"]
    objective_value: float | None
    parameters: dict[str, Any]
    metrics: dict[str, float]
    constraints: dict[str, float]
    failure_reason: str | None = None
    duration_ms: int | None = None
    reused_from_trial: int | None = Field(default=None, ge=0)


class RunProgress(BaseModel):
    run_id: str
    status: RunStatus
    completed_trials: int
    target_trials: int
    failed_trials: int
    reused_trials: int = 0
    best: BestTrial | None
    termination_reason: Literal["target_trials", "converged", "user"] | None = None
    trials: list[TrialSummary] = Field(default_factory=list)


class RunAnalysis(BaseModel):
    run_id: str
    parameter_importance: dict[str, float] = Field(default_factory=dict)
    completed_trials: int
