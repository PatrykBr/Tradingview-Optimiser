from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class StrategyParameterType(str, Enum):
    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    STRING = "string"


class StrategyMetric(str, Enum):
    NET_PROFIT = "net-profit"
    PROFIT_FACTOR = "profit-factor"
    SHARPE = "sharpe"
    SORTINO = "sortino"
    MAX_DD_PCT = "max-dd-pct"
    WIN_RATE = "win-rate"
    TRADES = "trades"


class FilterComparator(str, Enum):
    GTE = ">="
    LTE = "<="
    GT = ">"
    LT = "<"
    EQ = "="


class ParameterRange(BaseModel):
    min: float
    max: float
    step: float | None = None


class ParameterConfig(BaseModel):
    param_id: str = Field(alias="paramId")
    label: str | None = None
    type: StrategyParameterType
    enabled: bool = True
    range: ParameterRange


class FilterConfig(BaseModel):
    metric: StrategyMetric
    comparator: FilterComparator
    value: float


class OptimisationSettings(BaseModel):
    metric: StrategyMetric
    trials: int = Field(gt=0, lt=5001)
    use_custom_range: bool = Field(default=False, alias="useCustomRange")
    start_date: str | None = Field(default=None, alias="startDate")
    end_date: str | None = Field(default=None, alias="endDate")
    filters: list[FilterConfig] = Field(default_factory=list)


class OptimisationConfig(BaseModel):
    strategy_id: str = Field(alias="strategyId")
    params: list[ParameterConfig]
    settings: OptimisationSettings


class TrialResultPayload(BaseModel):
    metrics: dict[str, float]
    passed_filters: bool | None = Field(default=None, alias="passedFilters")


class MessageType:
    TYPE: str = "type"
    START: str = "start"
    STOP: str = "stop"
    TRIAL_RESULT: str = "trial-result"
    TRIAL_REQUEST: str = "trial-request"
    STATUS: str = "status"
    ERROR: str = "error"


class StartMessage(BaseModel):
    type: Literal["start"]
    config: OptimisationConfig


class TrialResultMessage(BaseModel):
    type: Literal["trial-result"]
    trial: int
    payload: TrialResultPayload


class StopMessage(BaseModel):
    type: Literal["stop"]

