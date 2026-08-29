from __future__ import annotations

import hmac
from contextlib import suppress
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path

logger = logging.getLogger("uvicorn.error")


class PairingError(ValueError):
    pass


class PairingManager:
    def __init__(
        self,
        token_path: Path,
        configured_token: str | None = None,
        code_ttl: timedelta = timedelta(minutes=30),
        max_attempts: int = 8,
    ) -> None:
        self._token_path = token_path
        self._code_ttl = code_ttl
        self._max_attempts = max_attempts
        self._attempts = 0

        if configured_token:
            self._token = configured_token
        else:
            self._token = self._load_or_create_token()

        self._pairing_code = ""
        self._pairing_code_expires_at = datetime.now(UTC)
        self._rotate_pairing_code()

    @property
    def token(self) -> str:
        return self._token

    @property
    def pairing_code_expires_at(self) -> datetime:
        return self._pairing_code_expires_at

    def pair(self, code: str) -> str:
        now = datetime.now(UTC)

        if now >= self._pairing_code_expires_at:
            self._rotate_pairing_code()
            raise PairingError("pairing code expired; use the new code shown by the backend")

        self._attempts += 1
        if self._attempts > self._max_attempts:
            self._rotate_pairing_code()
            raise PairingError("too many invalid pairing attempts; use the new backend code")

        normalised = code.strip().upper()
        if not hmac.compare_digest(normalised, self._pairing_code):
            raise PairingError("invalid pairing code")

        token = self._token
        self._rotate_pairing_code()
        return token

    def verify_token(self, token: str | None) -> bool:
        return token is not None and hmac.compare_digest(token, self._token)

    def _load_or_create_token(self) -> str:
        self._token_path.parent.mkdir(parents=True, exist_ok=True)

        if self._token_path.exists():
            token = self._token_path.read_text(encoding="utf-8").strip()
            if len(token) >= 32:
                return token

        token = secrets.token_urlsafe(32)
        self._token_path.write_text(token, encoding="utf-8")
        with suppress(OSError):
            os.chmod(self._token_path, 0o600)
        return token

    def _rotate_pairing_code(self) -> None:
        self._pairing_code = secrets.token_hex(4).upper()
        self._pairing_code_expires_at = datetime.now(UTC) + self._code_ttl
        self._attempts = 0

        logger.warning(
            "TradingView optimiser pairing code: %s (valid for %d minutes)",
            self._pairing_code,
            int(self._code_ttl.total_seconds() // 60),
        )
