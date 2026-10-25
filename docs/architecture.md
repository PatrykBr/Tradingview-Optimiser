# Code structure

[README](../README.md) · [Development](development.md)

The extension manages the browser run. TradingView evaluates each parameter set. The local backend selects trials through Optuna and saves studies in SQLite.

Bun owns the JavaScript workspace, dependency installation, development runtime, tests, formatting and type checking. WXT runs under Bun and retains responsibility for extension manifests, browser targets, content scripts, shadow-root CSS, hot reload and release archives. Python and `uv` retain the Optuna backend and Windows companion packaging. Bun's server and database APIs would duplicate that backend without replacing Optuna's sampling capabilities.

Paths below are relative to `extension/` unless they start with `backend/`.

## UI and run state

| Module                                             | Responsibility                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `components/App.tsx`                               | Assembles the optimiser UI.                                                        |
| `components/optimiser/useStrategyConfiguration.ts` | Manages strategy discovery, Pine inputs, saved configurations and run preparation. |
| `components/optimiser/useOptimisationRun.ts`       | Manages run persistence, recovery, trial sequencing and result actions.            |
| `components/optimiser/useBackendConnection.ts`     | Manages pairing and the local backend connection.                                  |
| `components/optimiser/useResearchValidation.ts`    | Manages research state, history persistence and cancellation.                      |

## Configuration

| Module                                                 | Responsibility                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `lib/optimisation/parameter-config.ts`                 | Enforces parameter editing rules for choices, steps, logarithmic search and conditions.     |
| `lib/optimisation/search-space.ts`                     | Validates the parameter draft and creates the dependency-ordered search space and baseline. |
| `lib/optimisation/draft.ts`                            | Defines the versioned form data used by saved configurations.                               |
| `lib/optimisation/run-config.ts`                       | Builds the persisted run configuration, filters, dates and research settings.               |
| `lib/optimisation/search-space-advisor.ts`             | Checks ranges and trial budgets without changing the configuration.                         |
| `components/optimiser/OptimisationSettingsSection.tsx` | Renders typed field definitions for research settings and filters.                          |

## Trial execution and research

| Module                                       | Responsibility                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `lib/optimisation/study-trial-runner.ts`     | Evaluates and sequences trials for normal runs and temporary walk-forward studies, including cancellation and failure reporting. |
| `lib/optimisation/auxiliary-study-runner.ts` | Runs temporary studies through the authenticated backend protocol.                                                               |
| `lib/optimisation/research-runner.ts`        | Owns the complete OOS, stability, walk-forward and Monte Carlo workflow, with one final chart restoration.                       |
| `lib/optimisation/research.ts`               | Analyses and ranks OOS and stability results.                                                                                    |
| `lib/optimisation/walk-forward.ts`           | Plans folds and summarises walk-forward results.                                                                                 |
| `lib/optimisation/monte-carlo.ts`            | Resamples trades and calculates simulation statistics.                                                                           |
| `lib/optimisation/research-verdict.ts`       | Rates the available research evidence.                                                                                           |

## TradingView and backend

| Module                                  | Responsibility                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `lib/tradingview/adapter.ts`            | Coordinates backtests and verifies that the chart still matches the run.                           |
| `lib/tradingview/page-report.ts`        | Reads reports and operates Deep Backtesting controls through the DOM when needed.                  |
| `entrypoints/tradingview-main-world.ts` | Reads and changes TradingView study and report data in the page context.                           |
| `backend/app/optimisation/manager.py`   | Persists Optuna studies and manages the ask/tell trial lifecycle.                                  |
| `lib/protocol/types.ts`                 | Defines backend commands and shared protocol data. Browser messages use the same command payloads. |
| `lib/messages.ts`                       | Sends typed browser requests, reconstructs errors and subscribes to background events.             |

## Workflow design

The background worker owns the paired backend connection and tab routing. It forwards backend commands unchanged, adding ownership handling only for create, abort and delete. `BackendClient.request` owns WebSocket correlation, timeouts and authentication. A command's browser response type is inferred from its discriminant; callers cannot choose an unrelated response type.

Research has one entry point, `runResearchValidation`. It runs enabled stages in order against the shared chart, verifies each evaluation and restores the parent range and selected parameters once in `finally`. The React hook handles presentation, cancellation and saving the result. Walk-forward children omit parent research settings and use the backend's disabled defaults.

Normal starts and history reruns share one start operation. It owns preparation, the busy state, error reporting and backend startup, so a history rerun is locked while its configuration is being prepared. New runs and resumes share one activation operation, which saves recovery state before starting trials. The lifecycle keeps one run snapshot for its configuration and original parameters. TradingView actions use the current chart's selected strategy ID rather than a potentially stale saved ID.

History loading, rerunning and resuming share configuration loading. Editing stays locked until the strategy, inputs and saved presets have loaded. A late initial recovery read cannot replace a run that has already been activated.

Configuration, trial execution, research and the TradingView adapter use the same `BacktestRange` model. Date fields are translated only when calling the page bridge. The adapter owns pre-flight compatibility checks alongside chart-context validation.

Experiment history follows `browser.storage.onChanged`. Initial loading cannot overwrite a newer storage event, and listeners stop on unmount. Research results, analysis and deletions appear after their storage write, without timers or explicit refresh calls.

Each backend run owns its lock. Live results and persisted Optuna trials pass through the same cache update operation for counts, reuse, convergence and the best feasible result. Restoring a study applies the same rules as processing it live.

The design uses typed contracts, native promises, `AbortSignal` and explicit resource scopes. A distributed workflow engine would still need to coordinate the same mutable TradingView chart and add deployment and recovery concerns. Parallel research stages would interfere with each other's parameters and date ranges. Sequential stages with one restoration scope fit the current application.

Field definitions stay local to the settings UI. They remove repeated markup and event wiring while existing configuration validation remains the authority for valid searches. A general form framework would add another configuration model for a fixed set of controls.
