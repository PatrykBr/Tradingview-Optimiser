from __future__ import annotations

import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import optuna
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


def _run_packaged_storage_self_test() -> None:
    with TemporaryDirectory(prefix="tradecopy-companion-self-test-") as temp_dir:
        database_path = Path(temp_dir) / "self-test.db"
        storage_url = f"sqlite:///{database_path.resolve()}"

        storage = optuna.storages.RDBStorage(storage_url)
        try:
            study = optuna.create_study(
                study_name="tradecopy-companion-self-test",
                storage=storage,
                direction="maximize",
            )
            trial = study.ask()
            trial.suggest_int("value", 1, 2)
            study.tell(trial, 1.0)

            if study.best_value != 1.0:
                raise RuntimeError(
                    "Optuna packaged storage self-test produced an unexpected result"
                )
        finally:
            # Windows cannot remove a SQLite database while SQLAlchemy still
            # has pooled connections open. Close the thread-local session and
            # dispose the engine before TemporaryDirectory cleans up.
            storage.remove_session()
            storage.engine.dispose()

    print("TradeCopy Companion packaged storage self-test passed.")


def main() -> None:
    if "--self-test" in sys.argv[1:]:
        _run_packaged_storage_self_test()
        return

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
