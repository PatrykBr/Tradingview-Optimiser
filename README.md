# TradingView Optuna Optimiser

A Chrome/Firefox extension that automatically optimises the Pine strategy on the user's current TradingView chart using Optuna v5.

TradingView performs the backtests. The extension controls the chart and reads Strategy Tester results, while a local FastAPI service runs the Optuna study.

## Features

- Detects Pine strategies and reads their inputs
- Numeric, boolean and categorical search spaces
- Min/max/step, logarithmic and conditional parameters
- Optuna v5 ask/tell optimisation with the current strategy settings used as the baseline trial
- Profit Factor, Net Profit, Sharpe, Sortino, drawdown and win-rate objectives
- Native Optuna v5 result constraints
- Optional TradingView Deep Backtesting date range
- Automatic parameter application and read-back verification
- Strategy Tester recalculation detection and retry handling
- Strategy/symbol/timeframe safety checks
- Persistent studies and resumable browser runs
- Live progress, ETA, best-so-far chart and full trial history
- Per-trial parameters, constraints and TradingView metrics
- Apply-best, restore-original and stop-state controls
- CSV and JSON exports
- TradingView compatibility diagnostics
- Secure one-time localhost backend pairing
- Chrome and Firefox builds
- Backend and extension unit tests

## Development

Requirements: Python 3.12+, `uv`, Node.js and pnpm.

Install dependencies:

```bash
pnpm install
```

Run the backend:

```bash
cd backend
uv sync --prerelease=allow
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

On first use, enter the pairing code printed by the backend into the extension.

Run Chrome development:

```bash
pnpm extension:dev
```

Run Firefox development:

```bash
pnpm extension:dev:firefox
```

Checks:

```bash
pnpm extension:typecheck
pnpm extension:test
pnpm extension:build
pnpm extension:build:firefox

cd backend
uv run pytest
```

Deep Backtesting requires TradingView to expose that feature for the current account.
