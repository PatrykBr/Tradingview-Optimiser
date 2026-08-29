# TradingView Optuna Optimiser

A Chrome/Firefox extension that automatically optimises the Pine strategy on the user's current TradingView chart using Optuna v5.

TradingView performs the backtests. The extension controls the chart and reads Strategy Tester results, while a local FastAPI service runs the Optuna study.

## Features

- Detects Pine strategies and reads their inputs
- Named optimisation configurations saved per exact strategy version
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
- Smart convergence stopping with configurable minimum trials, patience and improvement threshold
- PED-ANOVA parameter importance from the completed Optuna study
- Optional out-of-sample robustness mode that reserves unseen Deep Backtesting data and validates top candidates across sequential OOS folds
- Optional local stability testing around the robust/best parameter set
- Compact experiment history with side-by-side run, OOS and stability comparison
- Per-trial parameters, constraints and TradingView metrics
- Apply-best, restore-original and stop-state controls
- CSV and JSON exports
- TradingView compatibility diagnostics
- Secure one-time localhost backend pairing
- Chrome and Firefox builds
- Backend and extension unit tests

## Optimisation options

The extension keeps the basic workflow simple, while the research controls are optional. Hover over the corresponding controls in the extension for a short explanation.

### Core settings

| Option | What it does | When to use it |
| --- | --- | --- |
| **Metric** | The TradingView performance metric Optuna tries to maximise or minimise. | Pick the single metric that best represents the main goal of the strategy. Use filters for secondary requirements rather than trying to optimise everything at once. |
| **Max trials** | Maximum number of Optuna parameter combinations to evaluate. | Use a small value such as 5–20 for smoke testing, then increase it for real studies. Larger or more complex search spaces usually need more trials. |
| **Custom Deep Backtesting range** | Runs the study over a fixed TradingView Deep Backtesting period instead of the current chart session. | Use it for reproducible research and whenever out-of-sample robustness is enabled. It requires Deep Backtesting to be available on the TradingView account. |
| **Max drawdown %** | Marks trials above the chosen maximum drawdown as infeasible. | Use it when drawdown is a hard risk limit rather than the main objective. |
| **Min profit factor** | Marks trials below the chosen Profit Factor as infeasible. | Useful when optimising another metric such as Sharpe while still requiring a minimum level of profitability. |
| **Min trades** | Marks trials with too few trades as infeasible. | Use it to prevent Optuna from selecting impressive-looking results produced by a very small sample. |

Filters are constraints, not extra objectives. A trial can have a strong objective value and still be rejected if it violates a filter.

### Parameter search settings

| Option | What it does | When to use it |
| --- | --- | --- |
| **Min / Max** | Defines the search interval for a numeric Pine input. | Keep the interval wide enough to explore meaningfully, but avoid values that make no practical sense for the strategy. |
| **Step** | Restricts a numeric parameter to discrete increments. | Use the natural increment of the Pine input, for example 1 for an integer period or 0.1 for a decimal multiplier. |
| **Logarithmic search** | Samples a positive numeric range on a logarithmic scale. | Use when useful values may span orders of magnitude. Do not use it for narrow linear ranges or values that can be zero/negative. |
| **Categorical choices** | Chooses which boolean or categorical values Optuna may test. | Disable choices you never want the study to consider. |
| **Only optimise when** | Makes one parameter conditional on the value of another categorical parameter. | Use when an input only has meaning while a feature/mode is enabled. This prevents wasting trials on irrelevant combinations. |

### Research settings

These are opt-in. A normal optimisation works exactly as before when they are disabled.

| Option | What it does | When to use it |
| --- | --- | --- |
| **Stop when converged** | Ends the study before Max trials when the best feasible objective has stopped improving meaningfully. | Useful for larger trial budgets where Optuna may find a stable optimum well before the maximum. Leave it off for very small studies. |
| **Min trials** | Minimum number of completed trials before convergence stopping is allowed. | Set it high enough that Optuna gets a genuine exploration phase first. |
| **Patience** | Number of recent trials that may pass without sufficient improvement before stopping. | Increase it for noisy objectives or large search spaces. Lower values stop faster but are more aggressive. |
| **Min improve %** | Minimum improvement in the best feasible objective that counts as meaningful progress. | Lower it when even small gains matter. Raise it if you only care about materially better results. |
| **Out-of-sample robustness** | Reserves the final part of the Deep Backtesting range so Optuna never sees it, then re-tests the top feasible candidates on that unseen data. | Recommended for serious strategy research. It is much more useful than judging parameters only by their in-sample optimum. |
| **OOS %** | Percentage of the full date range reserved as unseen validation data. | **20–30%** is a good starting point. More OOS data strengthens validation but leaves less history for optimisation. |
| **Folds** | Splits the reserved OOS period into sequential validation windows. | **3 folds** is a good default. More folds give more regime checks but require more TradingView backtests. |
| **Candidates** | Number of top feasible Optuna trials to validate across the OOS folds. | **3–5** is a sensible default. More candidates reduce dependence on one lucky in-sample winner, but validation cost is roughly Candidates × Folds. |
| **Best-parameter stability test** | Re-tests the selected winner after slightly perturbing each numeric optimised parameter. | Recommended when you want to detect overfit parameter spikes. A robust strategy should usually tolerate small nearby changes. |
| **Perturbation %** | Distance moved around each parameter, measured as a percentage of that parameter's complete search range. | Around **5%** is a good default. Use smaller values for very sensitive/narrow ranges. |

### Reading the research results

**Parameter importance** is calculated with Optuna PED-ANOVA after enough feasible trials are available. A high percentage means that parameter had a larger influence on reaching the better-performing region of the study. Low-importance parameters are good candidates to fix or remove from a later optimisation, but importance is not proof of causality.

**Robust winner** is the top candidate after unseen validation. Ranking prioritises how many OOS folds satisfy the result filters, then the median OOS objective. This means it can deliberately choose a lower in-sample Optuna result if it generalises better.

**Degradation** shows how much the objective fell between optimisation and unseen validation. Lower is generally better. A negative value means the candidate actually performed better out of sample.

**Stability** measures how badly performance degrades when nearby numeric parameter values are tested:

- **Strong**: small nearby changes cause little degradation.
- **Moderate**: nearby values weaken performance noticeably.
- **Fragile**: small parameter changes cause large degradation or filter failures.

For serious research, a good default workflow is:

1. Choose a fixed Deep Backtesting range.
2. Enable out-of-sample robustness with roughly **30% OOS, 3 folds and 5 candidates**.
3. Enable the stability test at roughly **5% perturbation**.
4. Optionally enable convergence for large studies.
5. Run the Optuna study.
6. Run validation after optimisation finishes.
7. Prefer the robust winner over the raw in-sample best when the two disagree substantially.

## Architecture

The extension keeps orchestration at a few explicit seams:

- `components/App.tsx` only composes the optimiser UI.
- `components/optimiser/useStrategyConfiguration.ts` owns strategy discovery, Pine inputs, search-space configuration, presets and run preparation.
- `components/optimiser/useOptimisationRun.ts` owns persisted run lifecycle, resume/recovery, trial sequencing and result actions.
- `components/optimiser/useBackendConnection.ts` owns pairing and localhost backend connection state.
- `components/optimiser/useResearchValidation.ts` owns post-run OOS and stability validation.
- `lib/optimisation/research.ts` contains pure research splitting, ranking and stability maths.
- `lib/tradingview/adapter.ts` owns TradingView backtest orchestration and run-safety invariants.
- `lib/tradingview/page-report.ts` contains the DOM fallback for Strategy Report and Deep Backtesting controls.
- `entrypoints/tradingview-main-world.ts` stays focused on TradingView's page-side study/report data bridge.
- `backend/app/optimisation/manager.py` owns the persistent Optuna study and ask/tell lifecycle.

## Development

Requirements: Python 3.12+, `uv`, Node.js and pnpm.

Install dependencies:

```bash
pnpm install
```

Commit the generated `pnpm-lock.yaml` for reproducible extension builds.

Run the backend:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

The backend is configured to allow the Optuna v5 pre-release dependency consistently, so plain `uv sync` and `uv run` use the same resolver policy. Commit the generated `backend/uv.lock`.

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


## Research workflow

Research features are opt-in and do not change a normal optimisation.

When out-of-sample robustness is enabled, the selected Deep Backtesting range is split before optimisation. Optuna only sees the earlier training portion. After the study finishes, the user can run validation, which tests the top feasible parameter sets across sequential windows in the reserved unseen portion and ranks them by constraint passes and median OOS objective.

Stability validation perturbs each numeric optimised parameter around the selected winner and re-runs TradingView to identify sharp, fragile optima. Parameter importance is calculated on the persisted Optuna study using PED-ANOVA. Post-run TradingView validation is explicitly started by the user and can be cancelled.

Experiment history stores compact summaries for the most recent 50 completed/stopped studies rather than duplicating every historical trial in browser storage.
