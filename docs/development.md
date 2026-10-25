# Development

[README](../README.md) · [Code structure](architecture.md)

## Local setup

Requirements are Python 3.12 or later, `uv`, and Bun 1.4.4 or later, pinned in [package.json](../package.json).

Install extension dependencies from the repository root:

```sh
bun install
```

Install and start the backend in another terminal:

```sh
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Start the extension from the repository root:

```sh
bun run extension:dev
```

Use `bun run extension:dev:firefox` for Firefox. Enter the pairing code from the backend terminal in the extension on first use.

Commit changes to `bun.lock` and `backend/uv.lock` when dependencies change. The backend permits prerelease dependencies because it pins Optuna `5.0.0rc1`.

The backend's `.python-version` selects Python 3.12 for reproducible development and packaging. Extension installation runs `wxt prepare` under Bun to generate its TypeScript configuration before type checking. For reproducible installs, use `bun install --frozen-lockfile` and `uv sync --locked`.

## Checks and builds

Run formatting, browser/test type checks, extension tests, Python tests and Ruff together from the repository root:

```sh
bun run verify
```

Bun runs these independent checks in parallel. Build browser targets separately because WXT generates shared configuration:

```sh
bun run extension:typecheck
bun run extension:test
bun run extension:build
bun run extension:build:firefox
```

Other Bun tools:

```sh
bun run format
bun run extension:test:watch
bun run extension:test:coverage
bun run extension:zip
bun run extension:zip:firefox
bun audit
```

Tests use `bun:test` with a fresh global and module registry per file (`--isolate`), so module mocks cannot leak into other suites. To run files across CPU cores, use `bun run extension:test --parallel=4`. Test-only Bun declarations live in `tsconfig.test.json`; browser code is checked without Bun globals. `bun check` performs type checking; the matching TypeScript package remains for editor support. After upgrading Bun, check `bun -p process.versions.typescript` and keep the editor package aligned.

Bun's formatter configuration lives in `bunfig.toml`. Its native linter is currently canary-only, so stable development uses strict/unused TypeScript checks and Ruff. The backend checks can also run separately with `bun run backend:test` and `bun run backend:lint`.

Firefox ZIP packaging also produces a source archive containing the workspace manifest and `bun.lock`. Extract it, run `bun install --frozen-lockfile`, then `bun run extension:build:firefox` to rebuild the extension with the same dependency versions.

## Windows companion

The companion packages the same FastAPI and Optuna backend as a single console executable. Build it from the repository root on Windows:

```powershell
bun run backend:build-companion
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
