from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class FloatParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["float"]
    name: str
    low: float
    high: float
    step: float | None = None
    log: bool = False

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
    choices: list[str | int | float | bool]

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


class ChartContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str
    timeframe: str
    strategy_name: str


class CreateRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=8, max_length=128)
    objective_metric: str
    direction: ObjectiveDirection
    target_trials: int = Field(ge=1, le=100_000)
    parameters: list[SearchParameter] = Field(min_length=1, max_length=100)
    filters: list[MetricFilter] = Field(default_factory=list, max_length=50)
    chart: ChartContext

    @model_validator(mode="after")
    def unique_parameter_names(self) -> CreateRun:
        names = [parameter.name for parameter in self.parameters]
        if len(names) != len(set(names)):
            raise ValueError("parameter names must be unique")
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


class RunProgress(BaseModel):
    run_id: str
    status: RunStatus
    completed_trials: int
    target_trials: int
    failed_trials: int
    best: BestTrial | None
    trials: list[TrialSummary] = Field(default_factory=list)
