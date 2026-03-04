"""FastAPI backend with a local-only WebSocket endpoint for Optuna optimization.

Run with (recommended localhost bind):
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from collections import deque
from dataclasses import dataclass
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal, cast

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import (
    AskMessage,
    DeleteStudyFamilyMessage,
    DeleteStudyMessage,
    ErrorResponse,
    InitAck,
    InitMessage,
    StatusMessage,
    StatusResponse,
    TellAck,
    TellMessage,
    TrialSuggestion,
)
from optimizer import OptunaOptimizer, STORAGE_ROOT

# ============================================================
# Logging
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("backend")


# ============================================================
# Runtime config
# ============================================================

WS_RECEIVE_TIMEOUT = 300.0
MAX_WS_MESSAGE_BYTES = 256 * 1024  # 256 KB
MAX_MESSAGES_PER_MINUTE = 240
EXPOSE_DEBUG_DIAGNOSTICS = False
LOCAL_CORS_ORIGIN_REGEX = (
    r"^(chrome-extension://[a-p]{32}"
    r"|http://localhost(:\d+)?"
    r"|http://127\.0\.0\.1(:\d+)?)$"
)

IncomingMessageType = Literal[
    "init",
    "ask",
    "tell",
    "status",
    "delete_study",
    "delete_study_family",
]
OutgoingMessage = InitAck | TrialSuggestion | TellAck | StatusResponse | ErrorResponse

ALLOWED_MESSAGE_TYPES: frozenset[str] = frozenset(
    {
        "init",
        "ask",
        "tell",
        "status",
        "delete_study",
        "delete_study_family",
    }
)


@dataclass
class RuntimeMetrics:
    active_connections: int = 0
    total_connections: int = 0
    total_messages: int = 0
    total_errors: int = 0
    total_timeouts: int = 0
    total_asks: int = 0
    total_tells: int = 0
    total_deletes: int = 0
    ask_latency_ms_sum: float = 0.0
    tell_latency_ms_sum: float = 0.0
    delete_latency_ms_sum: float = 0.0
    last_error: str | None = None


METRICS = RuntimeMetrics()


# ============================================================
# Lifespan (startup / shutdown)
# ============================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("TradingView Strategy Optimizer backend starting on port 8765")
    logger.info("Health check: http://localhost:8765/health")
    logger.info("Metrics endpoint: http://localhost:8765/metrics")
    logger.info("WebSocket endpoint: ws://localhost:8765/ws/optimize/{study_name}")
    yield
    logger.info("Backend shutting down gracefully")


# ============================================================
# App
# ============================================================

app = FastAPI(
    title="TradingView Strategy Optimizer Backend",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCAL_CORS_ORIGIN_REGEX,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ============================================================
# Health / Metrics
# ============================================================


def _check_storage_ready() -> tuple[bool, str]:
    try:
        STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
        probe = STORAGE_ROOT / ".healthcheck.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


@app.get("/health")
async def health() -> JSONResponse:
    storage_ok, storage_detail = _check_storage_ready()
    ready = storage_ok
    body: dict[str, object] = {
        "status": "ok" if ready else "degraded",
        "engine": "optuna",
        "ready": ready,
        "storage": {"ok": storage_ok, "detail": storage_detail},
    }
    status_code = 200 if ready else 503
    return JSONResponse(content=body, status_code=status_code)


@app.get("/metrics")
async def metrics() -> JSONResponse:
    return JSONResponse(content=_build_metrics_payload(), status_code=200)


# ============================================================
# WebSocket helpers
# ============================================================


def _sanitize_error(exc: Exception) -> str:
    msg = str(exc).strip()
    return msg if msg else type(exc).__name__


def _average_latency_ms(total_ms: float, count: int) -> float | None:
    if count == 0:
        return None
    return total_ms / count


def _build_metrics_payload() -> dict[str, object]:
    payload: dict[str, object] = {
        "active_connections": METRICS.active_connections,
        "total_connections": METRICS.total_connections,
        "total_messages": METRICS.total_messages,
        "total_errors": METRICS.total_errors,
        "total_timeouts": METRICS.total_timeouts,
        "ask_count": METRICS.total_asks,
        "ask_latency_avg_ms": _average_latency_ms(
            METRICS.ask_latency_ms_sum,
            METRICS.total_asks,
        ),
        "tell_count": METRICS.total_tells,
        "tell_latency_avg_ms": _average_latency_ms(
            METRICS.tell_latency_ms_sum,
            METRICS.total_tells,
        ),
        "delete_count": METRICS.total_deletes,
        "delete_latency_avg_ms": _average_latency_ms(
            METRICS.delete_latency_ms_sum,
            METRICS.total_deletes,
        ),
    }
    if EXPOSE_DEBUG_DIAGNOSTICS:
        payload["last_error"] = METRICS.last_error
    return payload


async def _send(ws: WebSocket, msg: OutgoingMessage) -> None:
    await ws.send_text(msg.model_dump_json())


def _parse_json_object(raw: str) -> dict[str, object]:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("JSON payload must be an object.")
    return cast(dict[str, object], parsed)


def _extract_message_type(
    body: Mapping[str, object],
) -> IncomingMessageType | None:
    raw_type = body.get("type")
    if not isinstance(raw_type, str):
        return None
    if raw_type not in ALLOWED_MESSAGE_TYPES:
        return None
    return cast(IncomingMessageType, raw_type)


def _within_rate_limit(timestamps: deque[float]) -> bool:
    now = time.monotonic()
    window_start = now - 60.0
    while timestamps and timestamps[0] < window_start:
        timestamps.popleft()
    return len(timestamps) <= MAX_MESSAGES_PER_MINUTE


def _status_without_trials(request_id: str) -> StatusResponse:
    return StatusResponse(
        request_id=request_id,
        n_trials=0,
        best_value=None,
        best_params=None,
    )


def _study_not_initialized_error(request_id: str) -> ErrorResponse:
    return ErrorResponse(
        request_id=request_id,
        message="Study not initialized. Send 'init' first.",
    )


async def _require_optimizer(
    websocket: WebSocket,
    optimizer: OptunaOptimizer | None,
    request_id: str,
) -> OptunaOptimizer | None:
    if optimizer is not None:
        return optimizer
    await _send(websocket, _study_not_initialized_error(request_id))
    return None


async def _run_delete_and_ack(
    *,
    websocket: WebSocket,
    request_id: str,
    operation: Callable[[], None],
) -> None:
    t0 = time.monotonic()
    await asyncio.to_thread(operation)
    METRICS.total_deletes += 1
    METRICS.delete_latency_ms_sum += (time.monotonic() - t0) * 1000.0
    await _send(websocket, _status_without_trials(request_id))


# ============================================================
# WebSocket Optimization Endpoint
# ============================================================


@app.websocket("/ws/optimize/{study_name}")
async def websocket_optimize(websocket: WebSocket, study_name: str):
    await websocket.accept()
    METRICS.active_connections += 1
    METRICS.total_connections += 1
    logger.info("WebSocket connected for study: %s", study_name)

    optimizer: OptunaOptimizer | None = None
    message_timestamps: deque[float] = deque()

    try:
        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=WS_RECEIVE_TIMEOUT,
                )
            except asyncio.TimeoutError:
                METRICS.total_timeouts += 1
                logger.warning(
                    "WebSocket idle timeout (%ds) for study '%s' — closing",
                    int(WS_RECEIVE_TIMEOUT),
                    study_name,
                )
                await websocket.close(code=1000, reason="Idle timeout")
                break

            if len(raw.encode("utf-8")) > MAX_WS_MESSAGE_BYTES:
                METRICS.total_errors += 1
                await websocket.close(code=1009, reason="Message too large")
                break

            message_timestamps.append(time.monotonic())
            if not _within_rate_limit(message_timestamps):
                METRICS.total_errors += 1
                await websocket.close(code=1008, reason="Rate limit exceeded")
                break

            try:
                body = _parse_json_object(raw)
            except (json.JSONDecodeError, ValueError):
                METRICS.total_errors += 1
                await _send(websocket, ErrorResponse(message="Invalid JSON"))
                continue

            METRICS.total_messages += 1
            msg_type = _extract_message_type(body)
            request_id = body.get("request_id")
            if not isinstance(request_id, str):
                request_id = None

            try:
                if msg_type == "init":
                    msg = InitMessage.model_validate(body)
                    effective_name = study_name
                    if msg.study_name != study_name:
                        logger.warning(
                            "Init study_name '%s' differs from URL '%s' — using URL value",
                            msg.study_name,
                            study_name,
                        )
                    optimizer = await asyncio.to_thread(
                        OptunaOptimizer,
                        study_name=effective_name,
                        study_family=msg.study_family,
                        direction=msg.direction,
                        sampler=msg.sampler,
                        run_mode=msg.run_mode,
                        search_space=msg.search_space,
                        warm_start_trials=msg.warm_start_trials,
                    )
                    assert optimizer is not None
                    await _send(
                        websocket,
                        InitAck(
                            request_id=msg.request_id,
                            study_name=effective_name,
                            n_existing_trials=optimizer.n_existing_trials,
                        ),
                    )

                elif msg_type == "ask":
                    msg = AskMessage.model_validate(body)
                    ready_optimizer = await _require_optimizer(
                        websocket,
                        optimizer,
                        msg.request_id,
                    )
                    if ready_optimizer is None:
                        continue
                    t0 = time.monotonic()
                    trial_number, params, sampler = await asyncio.to_thread(
                        ready_optimizer.ask,
                        msg.search_space,
                    )
                    METRICS.total_asks += 1
                    METRICS.ask_latency_ms_sum += (time.monotonic() - t0) * 1000.0
                    await _send(
                        websocket,
                        TrialSuggestion(
                            request_id=msg.request_id,
                            trial_number=trial_number,
                            params=params,
                            sampler=sampler,
                        ),
                    )

                elif msg_type == "tell":
                    msg = TellMessage.model_validate(body)
                    ready_optimizer = await _require_optimizer(
                        websocket,
                        optimizer,
                        msg.request_id,
                    )
                    if ready_optimizer is None:
                        continue
                    t0 = time.monotonic()
                    result = await asyncio.to_thread(
                        ready_optimizer.tell,
                        trial_number=msg.trial_number,
                        value=msg.value,
                        state=msg.state,
                    )
                    METRICS.total_tells += 1
                    METRICS.tell_latency_ms_sum += (time.monotonic() - t0) * 1000.0
                    await _send(
                        websocket,
                        TellAck(
                            request_id=msg.request_id,
                            trial_number=msg.trial_number,
                            best_value=result["best_value"],
                            best_params=result["best_params"],
                            n_complete=result["n_complete"],
                        ),
                    )

                elif msg_type == "status":
                    msg = StatusMessage.model_validate(body)
                    if optimizer is None:
                        # Allow status pre-init for keepalive calls.
                        await _send(websocket, _status_without_trials(msg.request_id))
                        continue
                    stat = await asyncio.to_thread(optimizer.status)
                    await _send(
                        websocket,
                        StatusResponse(
                            request_id=msg.request_id,
                            n_trials=stat["n_trials"],
                            best_value=stat["best_value"],
                            best_params=stat["best_params"],
                        ),
                    )

                elif msg_type == "delete_study":
                    msg = DeleteStudyMessage.model_validate(body)
                    study_name_to_delete = msg.study_name
                    await _run_delete_and_ack(
                        websocket=websocket,
                        request_id=msg.request_id,
                        operation=lambda: OptunaOptimizer.delete_study(
                            study_name_to_delete,
                        ),
                    )

                elif msg_type == "delete_study_family":
                    msg = DeleteStudyFamilyMessage.model_validate(body)
                    study_family_to_delete = msg.study_family
                    await _run_delete_and_ack(
                        websocket=websocket,
                        request_id=msg.request_id,
                        operation=lambda: OptunaOptimizer.delete_study_family(
                            study_family_to_delete,
                        ),
                    )

                else:
                    await _send(
                        websocket,
                        ErrorResponse(
                            request_id=request_id,
                            message=f"Unknown message type: {msg_type}",
                        ),
                    )

            except Exception as exc:
                METRICS.total_errors += 1
                METRICS.last_error = f"{type(exc).__name__}: {exc}"
                logger.exception("Error processing message type '%s'", msg_type)
                await _send(
                    websocket,
                    ErrorResponse(
                        request_id=request_id,
                        message=_sanitize_error(exc),
                    ),
                )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for study: %s", study_name)
    except Exception:
        logger.exception("WebSocket error for study: %s", study_name)
    finally:
        METRICS.active_connections = max(0, METRICS.active_connections - 1)
        logger.info("Cleanup complete for study: %s", study_name)
