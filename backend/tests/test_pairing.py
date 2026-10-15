from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pairing import PairingError, PairingManager


def test_pairing_persists_token_and_rotates_code(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    codes = iter(["AAAABBBB", "CCCCDDDD", "EEEEFFFF"])
    monkeypatch.setattr("app.pairing.secrets.token_hex", lambda _: next(codes))

    path = tmp_path / "extension-token"
    manager = PairingManager(path)

    token = manager.pair("AAAABBBB")
    assert len(token) >= 32
    assert path.read_text(encoding="utf-8").strip() == token

    with pytest.raises(PairingError, match="invalid pairing code"):
        manager.pair("AAAABBBB")

    assert manager.pair("CCCCDDDD") == token


def test_pairing_rejects_invalid_code(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        "app.pairing.secrets.token_hex",
        lambda _: "1234ABCD",
    )
    manager = PairingManager(tmp_path / "extension-token")

    with pytest.raises(PairingError, match="invalid pairing code"):
        manager.pair("WRONG")



def test_pair_endpoint_exchanges_one_time_code(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    codes = iter(["AAAABBBB", "CCCCDDDD"])
    monkeypatch.setattr(
        "app.pairing.secrets.token_hex",
        lambda _: next(codes),
    )
    monkeypatch.setenv("TVOPT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("TVOPT_EXTENSION_TOKEN", raising=False)

    with TestClient(app) as client:
        invalid = client.post("/pair", json={"code": "WRONG"})
        assert invalid.status_code == 403

        paired = client.post("/pair", json={"code": "AAAABBBB"})
        assert paired.status_code == 200
        assert len(paired.json()["token"]) >= 32
