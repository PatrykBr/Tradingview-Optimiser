from __future__ import annotations

import hmac
from typing import Annotated

import optuna
from fastapi import Depends, Query, WebSocket, WebSocketDisconnect, WebSocketException, status
from pydantic import ValidationError

from app.models import CreateRun, TrialFailure, TrialResult
from app.optimisation.manager import OptimisationManager
from app.protocol import ConnectedPayload, Envelope, ErrorPayload, encode
from app.settings import Settings


def get_settings(websocket: WebSocket) -> Settings:
    return websocket.app.state.settings


def get_manager(websocket: WebSocket) -> OptimisationManager:
    return websocket.app.state.optimisation_manager


async def verify_token(
    websocket: WebSocket,
    token: Annotated[str | None, Query()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,
) -> None:
    if token is None or not hmac.compare_digest(token, settings.extension_token):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="invalid token")


async def websocket_endpoint(
    websocket: WebSocket,
    _: Annotated[None, Depends(verify_token)],
    manager: Annotated[OptimisationManager, Depends(get_manager)],
) -> None:
    await websocket.accept()
    await websocket.send_json(
        encode(
            "CONNECTED",
            ConnectedPayload(optuna_version=optuna.__version__),
        )
    )

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                envelope = Envelope.model_validate(raw)
                await _dispatch(websocket, manager, envelope)
            except (ValidationError, ValueError, KeyError) as exc:
                request_id = raw.get("request_id") if isinstance(raw, dict) else None
                await websocket.send_json(
                    encode(
                        "ERROR",
                        ErrorPayload(code="INVALID_REQUEST", message=str(exc), retryable=False),
                        request_id,
                    )
                )
    except WebSocketDisconnect:
        return


async def _dispatch(
    websocket: WebSocket,
    manager: OptimisationManager,
    envelope: Envelope,
) -> None:
    match envelope.type:
        case "PING":
            await websocket.send_json(encode("PONG", {}, envelope.request_id))
        case "CREATE_RUN":
            config = CreateRun.model_validate(envelope.payload)
            progress = await manager.create_run(config)
            await websocket.send_json(encode("RUN_PROGRESS", progress, envelope.request_id))
        case "START_RUN":
            run_id = str(envelope.payload["run_id"])
            progress, next_trial = await manager.start(run_id)
            await websocket.send_json(encode("RUN_PROGRESS", progress, envelope.request_id))
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "TRIAL_RESULT":
            result = TrialResult.model_validate(envelope.payload)
            progress, next_trial = await manager.submit_result(result)
            await websocket.send_json(encode("RUN_PROGRESS", progress, envelope.request_id))
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "TRIAL_FAILED":
            failure = TrialFailure.model_validate(envelope.payload)
            progress, next_trial = await manager.submit_failure(failure)
            await websocket.send_json(encode("RUN_PROGRESS", progress, envelope.request_id))
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "STOP_RUN":
            progress = await manager.stop(str(envelope.payload["run_id"]))
            await websocket.send_json(encode("RUN_PROGRESS", progress, envelope.request_id))
        case _:
            raise ValueError(f"unsupported message type: {envelope.type}")
