from __future__ import annotations

import logging
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from backend import main

def test_health_is_public_in_local_mode() -> None:
    with TestClient(main.app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["ready"] is True
        assert "security" not in payload


def test_metrics_are_public_and_redact_last_error_by_default() -> None:
    main.METRICS.last_error = "sensitive internal stack"

    with TestClient(main.app) as client:
        response = client.get("/metrics")
        assert response.status_code == 200
        payload = response.json()
        assert "last_error" not in payload


def test_metrics_include_last_error_when_debug_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main, "EXPOSE_DEBUG_DIAGNOSTICS", True)
    main.METRICS.last_error = "example error"

    with TestClient(main.app) as client:
        response = client.get("/metrics")
        assert response.status_code == 200
        payload = response.json()
        assert payload["last_error"] == "example error"


def test_websocket_logs_do_not_include_study_name(caplog: pytest.LogCaptureFixture) -> None:
    malicious_study_name = "bad\nname"
    encoded_study_name = quote(malicious_study_name, safe="")

    caplog.set_level(logging.INFO, logger="backend")

    with TestClient(main.app) as client:
        with client.websocket_connect(f"/ws/optimize/{encoded_study_name}") as websocket:
            websocket.close()

    messages = [record.getMessage() for record in caplog.records if record.name == "backend"]
    combined = "\n".join(messages)
    assert malicious_study_name not in combined
    assert "WebSocket connected" in messages
    assert "WebSocket disconnected" in messages
    assert "Cleanup complete" in messages
