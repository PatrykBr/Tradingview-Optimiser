# Code structure

[README](../README.md) · [Development](development.md)

The extension manages the browser run. TradingView evaluates each parameter set. The local backend selects trials through Optuna and saves studies in SQLite.

Paths below are relative to `extension/` unless they start with `backend/`.

## UI and run state

| Module | Responsibility |
| --- | --- |
| `components/App.tsx` | Assembles the optimiser UI. |
| `components/optimiser/useStrategyConfiguration.ts` | Manages strategy discovery, Pine inputs, saved configurations and run preparation. |
| `components/optimiser/useOptimisationRun.ts` | Manages run persistence, recovery, trial sequencing and result actions. |
| `components/optimiser/useBackendConnection.ts` | Manages pairing and the local backend connection. |
| `components/optimiser/useResearchValidation.ts` | Manages research state, history persistence and cancellation. |

## Configuration

| Module | Responsibility |
| --- | --- |
| `lib/optimisation/parameter-config.ts` | Enforces parameter editing rules for choices, steps, logarithmic search and conditions. |
| `lib/optimisation/search-space.ts` | Validates the parameter draft and creates the dependency-ordered search space and baseline. |
| `lib/optimisation/draft.ts` | Defines the versioned form data used by saved configurations. |
| `lib/optimisation/run-config.ts` | Builds the persisted run configuration, filters, dates and research settings. |
| `lib/optimisation/search-space-advisor.ts` | Checks ranges and trial budgets without changing the configuration. |

## Trial execution and research

| Module | Responsibility |
| --- | --- |
| `lib/optimisation/trial-executor.ts` | Evaluates TradingView trials for normal runs and temporary walk-forward studies. |
| `lib/optimisation/auxiliary-study-runner.ts` | Runs temporary studies through the authenticated backend protocol. |
| `lib/optimisation/research-runner.ts` | Runs fixed-parameter OOS and stability checks. |
| `lib/optimisation/walk-forward-runner.ts` | Runs a fresh study for each chronological fold. |
| `lib/optimisation/monte-carlo-runner.ts` | Loads the selected trade sample, repeating the backtest if needed. |
| `lib/optimisation/research.ts` | Analyses and ranks OOS and stability results. |
| `lib/optimisation/walk-forward.ts` | Plans folds and summarises walk-forward results. |
| `lib/optimisation/monte-carlo.ts` | Resamples trades and calculates simulation statistics. |
| `lib/optimisation/research-verdict.ts` | Rates the available research evidence. |

## TradingView and backend

| Module | Responsibility |
| --- | --- |
| `lib/tradingview/adapter.ts` | Coordinates backtests and verifies that the chart still matches the run. |
| `lib/tradingview/page-report.ts` | Reads reports and operates Deep Backtesting controls through the DOM when needed. |
| `entrypoints/tradingview-main-world.ts` | Reads and changes TradingView study and report data in the page context. |
| `backend/app/optimisation/manager.py` | Persists Optuna studies and manages the ask/tell trial lifecycle. |
