# TradingView Optuna Optimiser

A Chrome/Firefox browser extension plus a local FastAPI service that automatically optimises the Pine strategy already running on the user's current TradingView chart.

TradingView remains the backtest execution engine. The extension controls the live TradingView UI and reads Strategy Tester results, while Optuna v5 owns parameter sampling, constraints and optimisation state.

## Architecture

```text
TradingView tab
    ↕
WXT content script + Shadow DOM UI
    ↕
WXT background runtime
    ↕ WebSocket
FastAPI localhost service
    ↕
Optuna v5 study + SQLite storage
```

### Extension

`extension/`

- WXT 0.21
- React 19
- TypeScript
- Manifest V3
- Chrome and Firefox builds
- background-owned localhost WebSocket connection
- isolated Shadow DOM UI inside TradingView
- dedicated TradingView adapter so DOM-specific logic stays replaceable

### Backend

`backend/`

- FastAPI
- Pydantic v2
- Optuna v5
- persistent SQLite studies
- Optuna `Study.ask()` / `Study.tell()` external-evaluation workflow
- native Optuna v5 trial constraints
- localhost-only WebSocket API

## Current implementation

Implemented:

- typed extension/backend protocol
- authenticated localhost WebSocket
- heartbeat and reconnect handling
- optimisation run creation, start and stop
- persistent Optuna studies
- mixed float, integer and categorical search spaces
- native Optuna v5 constraints for filters such as:
  - maximum drawdown
  - minimum profit factor
  - minimum number of trades
- full trial metrics stored with the Optuna trial
- best feasible trial reporting
- failed-trial handling
- initial restart/recovery groundwork
- WXT Chrome/Firefox extension foundation
- React Shadow DOM optimiser panel
- TradingView strategy discovery probe
- TradingView strategy input discovery probe
- TradingView-specific selectors isolated in one adapter
- backend optimisation and WebSocket tests

## Current development target

The next milestone is the complete TradingView trial loop:

1. Reliably detect the strategy applied to the current chart.
2. Read and classify its Pine inputs.
3. Apply one Optuna-generated parameter combination.
4. Verify TradingView accepted every parameter.
5. Detect when the strategy has finished recalculating.
6. Read the Strategy Tester performance metrics.
7. Send those metrics back to Optuna.
8. Request and apply the next trial automatically.

After that:

- optimisation configuration UI
- metric selection
- trial-count configuration
- result filters
- Deep Backtesting/custom date ranges
- live progress and trial table
- apply-best-parameters action
- CSV export
- robust run resume
- production localhost pairing/authentication
- Chrome and Firefox hardening

## Repository layout

```text
TradeCopy-3/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── optimisation/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── protocol.py
│   │   └── settings.py
│   ├── tests/
│   └── pyproject.toml
│
├── extension/
│   ├── components/
│   ├── entrypoints/
│   ├── lib/
│   │   ├── protocol/
│   │   └── tradingview/
│   ├── package.json
│   ├── tsconfig.json
│   └── wxt.config.ts
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Development

### Requirements

- Python 3.12+
- `uv`
- Node.js
- pnpm

The repository root is an explicit pnpm workspace. Run pnpm commands from the repository root rather than from a parent directory.

### Install extension dependencies

From the repository root:

```bash
pnpm install
```

### Run the Chrome extension in development

From the repository root:

```bash
pnpm extension:dev
```

Equivalent command from inside `extension/`:

```bash
pnpm dev
```

### Run the Firefox extension in development

From `extension/`:

```bash
pnpm dev:firefox
```

### Type-check the extension

From the repository root:

```bash
pnpm extension:typecheck
```

### Build the extension

From the repository root:

```bash
pnpm extension:build
```

### Run the backend

```bash
cd backend
uv sync --prerelease=allow
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

The service intentionally binds only to `127.0.0.1`.

During development, the extension and backend currently share a bootstrap development token. This will be replaced by a proper one-time local pairing flow before production packaging.

## Testing

Backend:

```bash
cd backend
uv sync --prerelease=allow
uv run pytest
```

Extension:

```bash
pnpm extension:typecheck
pnpm extension:build
```

## Optimisation model

The browser evaluates each trial using the real TradingView Strategy Tester:

```text
Optuna study.ask()
      ↓
parameter combination
      ↓
extension applies values to TradingView
      ↓
TradingView recalculates strategy
      ↓
extension reads Strategy Tester metrics
      ↓
study.tell(trial, objective)
      ↓
Optuna chooses the next trial
```

This avoids reimplementing Pine strategy calculations in Python and keeps TradingView as the source of truth for every optimisation result.
