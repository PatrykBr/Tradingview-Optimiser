# Development

[README](../README.md) · [Code structure](architecture.md)

## Local setup

Requirements are Python 3.12 or later, `uv`, Node.js and the pnpm version in [package.json](../package.json).

Install extension dependencies from the repository root:

```sh
pnpm install
```

Install and start the backend in another terminal:

```sh
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Start the extension from the repository root:

```sh
pnpm extension:dev
```

Use `pnpm extension:dev:firefox` for Firefox. Enter the pairing code from the backend terminal in the extension on first use.

Commit changes to `pnpm-lock.yaml` and `backend/uv.lock` when dependencies change. The backend permits prerelease dependencies because it pins Optuna `5.0.0rc1`.

The backend's `.python-version` selects Python 3.12 for reproducible development and packaging. Extension installation runs `wxt prepare` to generate its TypeScript configuration before type checking.

## Checks and builds

Run extension checks from the repository root:

```sh
pnpm extension:typecheck
pnpm extension:test
pnpm extension:build
pnpm extension:build:firefox
```

Run backend tests from the `backend` directory:

```sh
uv run pytest
uv run ruff check .
```

## Windows companion

The companion packages the same FastAPI and Optuna backend as a single console executable. Build it from the repository root on Windows:

```powershell
pnpm backend:build-companion
```

The build writes:

```text
backend\dist\TradeCopy Companion.exe
```

Double-click the executable and keep its console window open while using the extension. The console prints the pairing code. The packaged backend stores persistent state in:

```text
%LOCALAPPDATA%\TradeCopy\data
```

The build script gets PyInstaller through `uv run --with`. PyInstaller is not a runtime dependency and does not enter the lockfile.

The companion specification bundles Optuna's RDB Alembic migration files. After packaging, the build script runs the executable with `--self-test` to create a temporary SQLite study. Missing migration files fail this check before you use the executable for optimisation.

The package omits Optuna's testing, visualization and CLI submodules and SQLAlchemy's SQLite test support. Those modules are not used by the companion.

## TradingView compatibility

Before starting or resuming a study, the extension checks chart access, strategy discovery, input reads and writes, the report source, metrics and the strategy signature. Runs that use Deep Backtesting also require its controls to be available.

During a run, the compatibility watchdog records the last successful trial. A fatal integration failure stops the run. Open **Diagnostics** in the panel to inspect the individual checks.

Closed-trade data is optional for normal optimisation. Its absence prevents Monte Carlo analysis but does not block other trials.

## Local protocol

WebSocket commands require the paired backend token. HTTP reads of `/runs/{run_id}` require the same token in `Authorization: Bearer <token>`. `/health` and the one-time pairing exchange remain unauthenticated.

Browser recovery storage currently tracks one active optimisation across the extension. Use one TradingView tab for active work. The storage mutation queue orders writes within a content-script context; it does not provide transactions across tabs.
