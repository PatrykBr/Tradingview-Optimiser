# TradingView Optuna Optimiser

A Chrome/Firefox extension that automatically optimises the Pine strategy on the user's current TradingView chart using Optuna v5.

TradingView remains the backtest engine. The extension applies parameter combinations and reads Strategy Tester results, while a local FastAPI service runs the Optuna study.

## Architecture

```text
TradingView
    ↕
Browser extension
    ↕ WebSocket
FastAPI
    ↕
Optuna v5 + SQLite
```

## Current status

Implemented:

- Chrome/Firefox extension with WXT, React and TypeScript
- local FastAPI backend
- Optuna v5 `Study.ask()` / `Study.tell()` optimisation flow
- persistent SQLite studies
- native Optuna v5 constraints
- TradingView strategy and Pine input detection
- numeric, boolean and categorical optimisation parameters
- configurable min/max/step ranges
- optimisation metric and trial-count selection
- maximum drawdown, minimum profit factor and minimum trade filters
- automatic TradingView parameter application with read-back verification
- Strategy Tester metric extraction
- recalculation settling between trials
- automatic sequential trial execution
- start/stop handling
- live progress, completed trials and best feasible result
- apply-best and restore-original parameter actions
- chart symbol/timeframe safety checks
- backend and WebSocket tests

Still to implement:

- custom Deep Backtesting date ranges
- richer per-trial detail/export UI
- robust resume after a TradingView tab reload
- production localhost pairing/authentication

## Development

Requirements:

- Python 3.12+
- `uv`
- Node.js
- pnpm

Install extension dependencies from the repository root:

```bash
pnpm install
```

Run the Chrome extension:

```bash
pnpm extension:dev
```

Run the Firefox extension:

```bash
cd extension
pnpm dev:firefox
```

Run the backend:

```bash
cd backend
uv sync --prerelease=allow
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Type-check and build the extension:

```bash
pnpm extension:typecheck
pnpm extension:build
```

Run backend tests:

```bash
cd backend
uv run pytest
```
