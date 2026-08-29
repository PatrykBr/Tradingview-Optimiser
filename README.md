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

- Chrome/Firefox extension foundation with WXT, React and TypeScript
- local FastAPI backend
- Optuna v5 `Study.ask()` / `Study.tell()` optimisation flow
- persistent SQLite studies
- float, integer and categorical search spaces
- native Optuna v5 constraints
- start/stop and failed-trial handling
- initial TradingView strategy and input detection
- backend and WebSocket tests

Next milestone:

- apply generated parameters to TradingView
- verify the values were accepted
- detect strategy recalculation completion
- read Strategy Tester metrics
- return each result to Optuna automatically

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
