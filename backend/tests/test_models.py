import pytest
from pydantic import ValidationError

from app.models import BacktestRange, CategoricalParameter, FloatParameter, MetricFilter


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_search_inputs_and_filters_reject_nonfinite_numbers(value: float) -> None:
    for payload in (
        {"low": value, "high": 2},
        {"low": 1, "high": value},
        {"low": 1, "high": 2, "step": value},
    ):
        with pytest.raises(ValidationError):
            FloatParameter(type="float", name="risk", **payload)
    with pytest.raises(ValidationError):
        CategoricalParameter(type="categorical", name="risk", choices=[1, value])
    with pytest.raises(ValidationError):
        MetricFilter(metric="profitFactor", operator="gte", value=value)


@pytest.mark.parametrize("start", ["20240201", "2024-02-30", "2024-W01-1"])
def test_backtest_dates_require_real_calendar_dates_in_iso_format(start: str) -> None:
    with pytest.raises(ValidationError):
        BacktestRange(mode="deep", start_date=start, end_date="2024-12-31")
