from fastapi.testclient import TestClient

from app.main import app


def test_websocket_rejects_invalid_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv(
        "TVOPT_EXTENSION_TOKEN",
        "0123456789abcdef0123456789abcdef",
    )

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(
                {
                    "type": "AUTH",
                    "request_id": "auth-1",
                    "payload": {"token": "bad"},
                }
            )

            try:
                websocket.receive_json()
                raise AssertionError("connection should have been rejected")
            except Exception:
                pass


def test_websocket_connects_and_pongs(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(
                {
                    "type": "AUTH",
                    "request_id": "auth-1",
                    "payload": {"token": token},
                }
            )

            connected = websocket.receive_json()
            assert connected["type"] == "CONNECTED"
            assert connected["payload"]["protocol_version"] == 1

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

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
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
            assert created["type"] == "RUN_PROGRESS"

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
