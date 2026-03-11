from __future__ import annotations

import pytest

from backend.models import CategoricalParam, StatusResponse, TellAck
from backend.optimizer import OptunaOptimizer
import optuna


def test_categorical_param_rejects_non_finite_float_choices() -> None:
    with pytest.raises(ValueError, match="must be finite"):
        CategoricalParam(
            name="choice",
            type="categorical",
            choices=[1.0, float("nan")],
        )


def test_tell_ack_optional_best_fields_default_to_none() -> None:
    message = TellAck(
        request_id="req-1",
        trial_number=3,
        n_complete=2,
    )

    assert message.best_value is None
    assert message.best_params is None


def test_status_response_optional_best_fields_default_to_none() -> None:
    message = StatusResponse(
        request_id="req-1",
        n_trials=0,
    )

    assert message.best_value is None
    assert message.best_params is None


def test_distribution_contains_external_value_rejects_nan() -> None:
    distribution = optuna.distributions.FloatDistribution(low=0.0, high=1.0)

    assert not OptunaOptimizer._distribution_contains_external_value(
        distribution,
        float("nan"),
    )
