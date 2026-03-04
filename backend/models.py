"""Pydantic schemas for WebSocket messages between extension and backend."""

from __future__ import annotations

import math
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ============================================================
# Validation constants
# ============================================================

IDENTIFIER_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
PARAM_NAME_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"

MAX_SEARCH_SPACE_PARAMS = 128
MAX_CATEGORICAL_CHOICES = 256
MAX_WARM_START_SEEDS = 5000
MAX_STRING_CHOICE_LEN = 128


StudyIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=64, pattern=IDENTIFIER_PATTERN),
]
RequestIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=64, pattern=IDENTIFIER_PATTERN),
]
ParamIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=64, pattern=PARAM_NAME_PATTERN),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ============================================================
# Search Space
# ============================================================


class FloatParam(StrictModel):
    name: ParamIdentifier
    type: Literal["float"]
    low: float = Field(ge=-1e12, le=1e12, allow_inf_nan=False)
    high: float = Field(ge=-1e12, le=1e12, allow_inf_nan=False)
    step: float | None = Field(default=None, gt=0, le=1e12, allow_inf_nan=False)
    log: bool = False

    @model_validator(mode="after")
    def _validate_bounds(self) -> "FloatParam":
        if self.high <= self.low:
            raise ValueError("Float param requires high > low.")
        if self.log and self.low <= 0:
            raise ValueError("Float param with log=true requires low > 0.")
        if self.log and self.step is not None:
            raise ValueError("Float param cannot set step when log=true.")
        return self


class IntParam(StrictModel):
    name: ParamIdentifier
    type: Literal["int"]
    low: int = Field(ge=-1_000_000_000, le=1_000_000_000)
    high: int = Field(ge=-1_000_000_000, le=1_000_000_000)
    step: int | None = Field(default=None, ge=1, le=1_000_000)
    log: bool = False

    @model_validator(mode="after")
    def _validate_bounds(self) -> "IntParam":
        if self.high <= self.low:
            raise ValueError("Int param requires high > low.")
        if self.log and self.low <= 0:
            raise ValueError("Int param with log=true requires low > 0.")
        return self


class CategoricalParam(StrictModel):
    name: ParamIdentifier
    type: Literal["categorical"]
    choices: list[str | int | float | bool] = Field(
        min_length=1,
        max_length=MAX_CATEGORICAL_CHOICES,
    )

    @field_validator("choices")
    @classmethod
    def _validate_choices(cls, value: list[str | int | float | bool]) -> list[str | int | float | bool]:
        cleaned: list[str | int | float | bool] = []
        for item in value:
            if isinstance(item, str):
                if not item:
                    raise ValueError("Categorical choices cannot contain empty strings.")
                if len(item) > MAX_STRING_CHOICE_LEN:
                    raise ValueError("Categorical string choices exceed max length.")
            elif isinstance(item, float):
                if not math.isfinite(item):
                    raise ValueError("Categorical numeric choices must be finite.")
            cleaned.append(item)
        return cleaned


SearchSpaceParam = Annotated[
    Union[FloatParam, IntParam, CategoricalParam],
    Field(discriminator="type"),
]


# ============================================================
# Incoming messages (from extension)
# ============================================================


class WarmStartTrialSeed(StrictModel):
    params: dict[ParamIdentifier, float | int | str | bool] = Field(
        min_length=1,
        max_length=MAX_SEARCH_SPACE_PARAMS,
    )
    value: float = Field(ge=-1e15, le=1e15, allow_inf_nan=False)

    @field_validator("params")
    @classmethod
    def _validate_seed_params(
        cls,
        params: dict[str, float | int | str | bool],
    ) -> dict[str, float | int | str | bool]:
        for key, val in params.items():
            if not key:
                raise ValueError("Warm start params require non-empty keys.")
            if isinstance(val, str) and len(val) > MAX_STRING_CHOICE_LEN:
                raise ValueError("Warm start string parameter exceeds max length.")
            if isinstance(val, float) and not math.isfinite(val):
                raise ValueError("Warm start numeric values must be finite.")
        return params


class InitMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["init"]
    study_name: StudyIdentifier
    study_family: StudyIdentifier | None = None
    direction: Literal["minimize", "maximize"]
    sampler: Literal["auto", "tpe", "random", "gp", "qmc", "cmaes"] = "auto"
    run_mode: Literal["resume", "fresh", "warm_start"] = "fresh"
    search_space: list[SearchSpaceParam] = Field(
        min_length=1,
        max_length=MAX_SEARCH_SPACE_PARAMS,
    )
    warm_start_trials: list[WarmStartTrialSeed] | None = Field(
        default=None,
        max_length=MAX_WARM_START_SEEDS,
    )


class AskMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["ask"]
    search_space: list[SearchSpaceParam] = Field(
        min_length=1,
        max_length=MAX_SEARCH_SPACE_PARAMS,
    )


class TellMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["tell"]
    trial_number: int = Field(ge=0, le=10_000_000)
    value: float | None = Field(default=None, ge=-1e15, le=1e15, allow_inf_nan=False)
    state: Literal["complete", "pruned", "fail"]


class StatusMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["status"]


class DeleteStudyMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["delete_study"]
    study_name: StudyIdentifier


class DeleteStudyFamilyMessage(StrictModel):
    request_id: RequestIdentifier
    type: Literal["delete_study_family"]
    study_family: StudyIdentifier


IncomingMessage = Union[
    InitMessage,
    AskMessage,
    TellMessage,
    StatusMessage,
    DeleteStudyMessage,
    DeleteStudyFamilyMessage,
]


# ============================================================
# Outgoing messages (to extension)
# ============================================================


class InitAck(StrictModel):
    request_id: RequestIdentifier
    type: Literal["init_ack"] = "init_ack"
    study_name: StudyIdentifier
    n_existing_trials: int


class TrialSuggestion(StrictModel):
    request_id: RequestIdentifier
    type: Literal["trial"] = "trial"
    trial_number: int
    params: dict[str, float | int | str | bool]
    sampler: str | None = None


class TellAck(StrictModel):
    request_id: RequestIdentifier
    type: Literal["tell_ack"] = "tell_ack"
    trial_number: int
    best_value: float | None
    best_params: dict[str, float | int | str | bool] | None
    n_complete: int


class StatusResponse(StrictModel):
    request_id: RequestIdentifier
    type: Literal["status"] = "status"
    n_trials: int
    best_value: float | None
    best_params: dict[str, float | int | str | bool] | None


class DeleteAck(StrictModel):
    request_id: RequestIdentifier
    type: Literal["delete_ack"] = "delete_ack"
    deleted: Literal["study", "study_family"]
    target: StudyIdentifier


class ErrorResponse(StrictModel):
    request_id: RequestIdentifier | None = None
    type: Literal["error"] = "error"
    message: str
