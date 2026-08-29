from __future__ import annotations

import asyncio

import optuna
from fastapi import WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.models import CreateRun, TrialFailure, TrialResult
from app.optimisation.manager import OptimisationManager
from app.pairing import PairingManager
from app.protocol import ConnectedPayload, Envelope, ErrorPayload, encode


async def websocket_endpoint(websocket: WebSocket) -> None:
    pairing: PairingManager = websocket.app.state.pairing_manager
    manager: OptimisationManager = websocket.app.state.optimisation_manager

    await websocket.accept()

    if not await _authenticate(websocket, pairing):
        return

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
                        ErrorPayload(
                            code="INVALID_REQUEST",
                            message=str(exc),
                            retryable=False,
                        ),
                        request_id,
                    )
                )
    except WebSocketDisconnect:
        return


async def _authenticate(
    websocket: WebSocket,
    pairing: PairingManager,
) -> bool:
    try:
        raw = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=5.0,
        )
        envelope = Envelope.model_validate(raw)
    except (TimeoutError, ValidationError, ValueError, WebSocketDisconnect):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="authentication required",
        )
        return False

    token = envelope.payload.get("token")
    if (
        envelope.type != "AUTH"
        or not isinstance(token, str)
        or not pairing.verify_token(token)
    ):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="invalid token",
        )
        return False

    return True


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
            await websocket.send_json(
                encode("RUN_PROGRESS", progress, envelope.request_id)
            )
        case "START_RUN":
            run_id = str(envelope.payload["run_id"])
            progress, next_trial = await manager.start(run_id)
            await websocket.send_json(
                encode("RUN_PROGRESS", progress, envelope.request_id)
            )
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "TRIAL_RESULT":
            result = TrialResult.model_validate(envelope.payload)
            progress, next_trial = await manager.submit_result(result)
            await websocket.send_json(
                encode("RUN_PROGRESS", progress, envelope.request_id)
            )
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "TRIAL_FAILED":
            failure = TrialFailure.model_validate(envelope.payload)
            progress, next_trial = await manager.submit_failure(failure)
            await websocket.send_json(
                encode("RUN_PROGRESS", progress, envelope.request_id)
            )
            if next_trial is not None:
                await websocket.send_json(encode("NEXT_TRIAL", next_trial))
        case "STOP_RUN":
            progress = await manager.stop(str(envelope.payload["run_id"]))
            await websocket.send_json(
                encode("RUN_PROGRESS", progress, envelope.request_id)
            )
        case "GET_RUN_ANALYSIS":
            if "config" in envelope.payload:
                config = CreateRun.model_validate(envelope.payload["config"])
                await manager.create_run(config)
            analysis = await manager.analysis(str(envelope.payload["run_id"]))
            await websocket.send_json(
                encode("RUN_ANALYSIS", analysis, envelope.request_id)
            )
        case _:
            raise ValueError(f"unsupported message type: {envelope.type}")
