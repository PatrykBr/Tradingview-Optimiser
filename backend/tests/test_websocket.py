import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


def test_websocket_rejects_invalid_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv(
        "TVOPT_EXTENSION_TOKEN",
        "0123456789abcdef0123456789abcdef",
    )

    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as websocket,
    ):
        websocket.send_json(
            {
                "type": "AUTH",
                "request_id": "auth-1",
                "payload": {"token": "bad"},
            }
        )

        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_websocket_connects_and_pongs(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)

    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as websocket,
    ):
        websocket.send_json(
            {
                "type": "AUTH",
                "request_id": "auth-1",
                "payload": {"token": token},
            }
        )

        connected = websocket.receive_json()
        assert connected["type"] == "CONNECTED"
        assert connected["payload"]["protocol_version"] == 2
        assert connected["payload"]["backend_version"] == "0.2.0"
        assert connected["payload"]["optuna_version"]

        websocket.send_json(
            {
                "type": "PING",
                "request_id": "ping-1",
                "payload": {},
            }
        )
        pong = websocket.receive_json()
        assert pong == {
            "type": "PONG",
            "request_id": "ping-1",
            "payload": {},
        }


def test_websocket_returns_run_analysis(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)

    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as websocket,
    ):
        websocket.send_json(
            {
                "type": "AUTH",
                "request_id": "auth-1",
                "payload": {"token": token},
            }
        )
        websocket.receive_json()

        websocket.send_json(
            {
                "type": "CREATE_RUN",
                "request_id": "create-1",
                "payload": {
                    "run_id": "analysis-run",
                    "objective_metric": "profitFactor",
                    "direction": "maximize",
                    "target_trials": 5,
                    "parameters": [
                        {
                            "type": "int",
                            "name": "length",
                            "low": 5,
                            "high": 20,
                            "step": 1,
                        }
                    ],
                    "filters": [],
                    "chart": {
                        "symbol": "OANDA:XAUUSD",
                        "timeframe": "5",
                        "strategy_name": "Test Strategy",
                        "strategy_signature": "signature-123",
                    },
                },
            }
        )
        created = websocket.receive_json()
        assert created == {
            "type": "RUN_CREATED",
            "request_id": "create-1",
            "payload": {
                "run_id": "analysis-run",
                "status": "created",
            },
        }

        websocket.send_json(
            {
                "type": "GET_RUN_ANALYSIS",
                "request_id": "analysis-1",
                "payload": {"run_id": "analysis-run"},
            }
        )
        analysis = websocket.receive_json()

        assert analysis["type"] == "RUN_ANALYSIS"
        assert analysis["request_id"] == "analysis-1"
        assert analysis["payload"]["completed_trials"] == 0
        assert analysis["payload"]["parameter_importance"] == {}


def test_websocket_deletes_completed_run(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)

    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as websocket,
    ):
        websocket.send_json(
            {
                "type": "AUTH",
                "request_id": "auth-1",
                "payload": {"token": token},
            }
        )
        websocket.receive_json()

        websocket.send_json(
            {
                "type": "CREATE_RUN",
                "request_id": "create-delete",
                "payload": {
                    "run_id": "delete-run",
                    "objective_metric": "profitFactor",
                    "direction": "maximize",
                    "target_trials": 1,
                    "parameters": [
                        {
                            "type": "int",
                            "name": "length",
                            "low": 5,
                            "high": 20,
                            "step": 1,
                        }
                    ],
                    "filters": [],
                    "chart": {
                        "symbol": "OANDA:XAUUSD",
                        "timeframe": "5",
                        "strategy_name": "Test Strategy",
                        "strategy_signature": "signature-123",
                    },
                },
            }
        )
        websocket.receive_json()

        websocket.send_json(
            {
                "type": "STOP_RUN",
                "request_id": "stop-delete",
                "payload": {"run_id": "delete-run"},
            }
        )
        stopped = websocket.receive_json()
        assert stopped["type"] == "RUN_UPDATE"
        assert stopped["payload"]["status"] == "stopped"
        assert stopped["payload"]["trial_updates"] == []

        websocket.send_json(
            {
                "type": "DELETE_RUN",
                "request_id": "delete-1",
                "payload": {"run_id": "delete-run"},
            }
        )
        deleted = websocket.receive_json()

        assert deleted == {
            "type": "RUN_DELETED",
            "request_id": "delete-1",
            "payload": {"run_id": "delete-run"},
        }


def test_websocket_streams_incremental_trial_updates(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)

    with (
        TestClient(app) as client,
        client.websocket_connect("/ws") as websocket,
    ):
        websocket.send_json(
            {
                "type": "AUTH",
                "request_id": "auth-1",
                "payload": {"token": token},
            }
        )
        websocket.receive_json()

        websocket.send_json(
            {
                "type": "CREATE_RUN",
                "request_id": "create-1",
                "payload": {
                    "run_id": "incremental-run",
                    "objective_metric": "profitFactor",
                    "direction": "maximize",
                    "target_trials": 1,
                    "parameters": [
                        {
                            "type": "int",
                            "name": "length",
                            "low": 5,
                            "high": 20,
                            "step": 1,
                        }
                    ],
                    "filters": [],
                    "chart": {
                        "symbol": "OANDA:XAUUSD",
                        "timeframe": "5",
                        "strategy_name": "Test Strategy",
                        "strategy_signature": "signature-123",
                    },
                },
            }
        )
        created = websocket.receive_json()
        assert created["type"] == "RUN_CREATED"
        assert "trials" not in created["payload"]

        websocket.send_json(
            {
                "type": "START_RUN",
                "request_id": "start-1",
                "payload": {"run_id": "incremental-run"},
            }
        )
        started = websocket.receive_json()
        assert started["type"] == "RUN_PROGRESS"

        next_trial = websocket.receive_json()
        assert next_trial["type"] == "NEXT_TRIAL"

        websocket.send_json(
            {
                "type": "TRIAL_RESULT",
                "request_id": "result-1",
                "payload": {
                    "run_id": "incremental-run",
                    "trial_number": next_trial["payload"]["trial_number"],
                    "metrics": {
                        "profitFactor": 1.7,
                        "totalTrades": 100,
                    },
                },
            }
        )

        update = websocket.receive_json()
        assert update["type"] == "RUN_UPDATE"
        assert update["request_id"] == "result-1"
        assert update["payload"]["status"] == "completed"
        assert update["payload"]["completed_trials"] == 1
        assert len(update["payload"]["trial_updates"]) == 1
        assert update["payload"]["trial_updates"][0]["trial_number"] == 0
