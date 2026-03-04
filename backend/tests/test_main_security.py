from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import main

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
