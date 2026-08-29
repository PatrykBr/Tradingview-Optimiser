from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

from app.main import app
from app.settings import Settings


def _configure_frozen_data_dir() -> None:
    if not getattr(sys, "frozen", False):
        return

    if os.environ.get("TVOPT_DATA_DIR"):
        return

    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home()
    data_dir = base / "TradeCopy" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["TVOPT_DATA_DIR"] = str(data_dir)


def main() -> None:
    _configure_frozen_data_dir()
    settings = Settings()

    print()
    print("TradeCopy Companion")
    print("===================")
    print("Keep this window open while using the TradingView optimiser.")
    print("The extension connects only to this local service.")
    print()
    print(
        f"Starting on http://{settings.host}:{settings.port} "
        f"(data: {settings.data_dir.resolve()})"
    )
    print()

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
