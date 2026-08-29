from fastapi.testclient import TestClient

from app.main import app


def test_websocket_rejects_invalid_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", "0123456789abcdef0123456789abcdef")
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/ws?token=bad"):
                raise AssertionError("connection should have been rejected")
        except Exception:
            pass


def test_websocket_connects_and_pongs(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    token = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("TVOPT_EXTENSION_TOKEN", token)
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws?token={token}") as websocket:
            connected = websocket.receive_json()
            assert connected["type"] == "CONNECTED"
            assert connected["payload"]["protocol_version"] == 1

            websocket.send_json({"type": "PING", "request_id": "ping-1", "payload": {}})
            pong = websocket.receive_json()
            assert pong == {"type": "PONG", "request_id": "ping-1", "payload": {}}
