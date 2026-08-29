# TradingView Optuna Optimiser

A Chrome/Firefox browser extension plus localhost FastAPI service that optimises the Pine strategy already running on the user's TradingView chart.

## Architecture

- `extension/`: WXT + React + TypeScript WebExtension.
- `backend/`: FastAPI + Optuna v5 ask/tell optimisation service.
- TradingView remains the backtest execution engine.
- Optuna owns parameter sampling and constrained optimisation.

## Current vertical slice

Implemented:
- typed extension/backend protocol
- authenticated localhost WebSocket
- run creation/start/stop
- Optuna v5 persistent SQLite studies
- mixed float/int/categorical search spaces
- native Optuna v5 trial constraints
- trial metrics persisted as Optuna user attributes
- best feasible result reporting
- content-script shell with isolated Shadow DOM UI
- TradingView strategy/input discovery adapter skeleton
- background-owned backend connection
- unit tests for optimisation semantics

Next implementation target:
- harden TradingView DOM locators against the current live UI
- apply parameter values and verify round-trip
- Strategy Tester metrics extraction
- recalculation detection

## Development

Backend:

```bash
cd backend
uv sync --prerelease=allow
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Extension:

```bash
cd extension
pnpm install
pnpm dev
# Firefox:
pnpm dev:firefox
```

The backend intentionally binds to loopback only.
