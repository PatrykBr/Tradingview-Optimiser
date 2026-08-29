from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import CreateRun, NextTrial, RunProgress, TrialFailure, TrialResult


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    request_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ErrorPayload(BaseModel):
    code: str
    message: str
    retryable: bool = False


class ConnectedPayload(BaseModel):
    protocol_version: Literal[1] = 1
    optuna_version: str


def encode(message_type: str, payload: BaseModel | dict[str, Any], request_id: str | None = None) -> dict:
    body = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return Envelope(type=message_type, request_id=request_id, payload=body).model_dump(mode="json")


INBOUND_MODELS = {
    "CREATE_RUN": CreateRun,
    "TRIAL_RESULT": TrialResult,
    "TRIAL_FAILED": TrialFailure,
}

OUTBOUND_MODELS = {
    "NEXT_TRIAL": NextTrial,
    "RUN_PROGRESS": RunProgress,
}
