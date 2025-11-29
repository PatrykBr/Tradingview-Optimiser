from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


class StrategyParameterType(str, Enum):
    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    STRING = "string"
    SOURCE = "source"
    RESOLUTION = "resolution"


class StrategyMetric(str, Enum):
    NET_PROFIT = "net-profit"
    PROFIT_FACTOR = "profit-factor"
    SHARPE = "sharpe"
    SORTINO = "sortino"
    MAX_DD_PCT = "max-dd-pct"
    WIN_RATE = "win-rate"
    TRADES = "trades"
    DRAWDOWN = "drawdown"  # Alias for MAX_DD_PCT for backwards compatibility
    CUSTOM = "custom"


@dataclass(frozen=True, slots=True)
class MetricInfo:
    """Metadata for a strategy metric."""

    property_key: str
    label: str


METRIC_INFO: dict[StrategyMetric, MetricInfo] = {
    StrategyMetric.NET_PROFIT: MetricInfo("netProfit", "Net Profit"),
    StrategyMetric.PROFIT_FACTOR: MetricInfo("profitFactor", "Profit Factor"),
    StrategyMetric.SHARPE: MetricInfo("sharpe", "Sharpe Ratio"),
    StrategyMetric.SORTINO: MetricInfo("sortino", "Sortino Ratio"),
    StrategyMetric.MAX_DD_PCT: MetricInfo("maxDrawdownPct", "Max Drawdown %"),
    StrategyMetric.WIN_RATE: MetricInfo("winRatePct", "Win Rate %"),
    StrategyMetric.TRADES: MetricInfo("numberOfTrades", "Number of Trades"),
    StrategyMetric.DRAWDOWN: MetricInfo("maxDrawdownPct", "Max Drawdown %"),
    StrategyMetric.CUSTOM: MetricInfo("customMetric", "Custom Metric"),
}


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

    @field_validator("max")
    @classmethod
    def ensure_range(cls, value: float, info: ValidationInfo) -> float:
        if (min_val := info.data.get("min")) is not None and value <= min_val:
            raise ValueError("max must be greater than min")
        return value


class ParameterConfig(BaseModel):
    param_id: str = Field(alias="paramId")
    label: str | None = None
    type: StrategyParameterType
    enabled: bool = True
    range: ParameterRange

    model_config: ClassVar[ConfigDict] = ConfigDict(populate_by_name=True)


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

    model_config: ClassVar[ConfigDict] = ConfigDict(populate_by_name=True)


class OptimisationConfig(BaseModel):
    strategy_id: str = Field(alias="strategyId")
    params: list[ParameterConfig]
    settings: OptimisationSettings

    model_config: ClassVar[ConfigDict] = ConfigDict(populate_by_name=True)


class TrialResultPayload(BaseModel):
    metrics: dict[str, float]
    passed_filters: bool | None = Field(default=None, alias="passedFilters")

    model_config: ClassVar[ConfigDict] = ConfigDict(populate_by_name=True)


class MessageType:
    """WebSocket message type constants."""

    TYPE: Final = "type"  # JSON key for message type field
    START: Final = "start"
    STOP: Final = "stop"
    TRIAL_RESULT: Final = "trial-result"
    TRIAL_REQUEST: Final = "trial-request"
    TRIAL_COMPLETE: Final = "trial-complete"
    COMPLETE: Final = "complete"
    STATUS: Final = "status"
    ERROR: Final = "error"


class StartMessage(BaseModel):
    type: Literal["start"]
    config: OptimisationConfig


class TrialResultMessage(BaseModel):
    type: Literal["trial-result"]
    trial: int
    payload: TrialResultPayload


class StopMessage(BaseModel):
    type: Literal["stop"]


class OptimisationInterrupted(Exception):
    """Raised when optimisation loop should terminate gracefully."""
