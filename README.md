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
- Search-space pre-flight advisor for range, branch-sampling and trial-budget warnings
- Full walk-forward re-optimisation with a fresh Optuna study per chronological fold
- Defensive trade-level Monte Carlo bootstrap analysis when TradingView exposes closed trades
- Transparent research-evidence verdict with explicit strengths/concerns rather than a black-box score
- Compact experiment history with side-by-side run, OOS, walk-forward and Monte Carlo comparison
- Load/edit or exactly re-run historical experiment configurations
- Experiment reproducibility metadata including extension, backend and Optuna versions
- TradingView compatibility watchdog with pre-run capability checks and last-successful-trial status
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

### Search-space pre-flight

The parameter section includes a collapsed **Pre-flight check**. It is a heuristic reviewer, not an automatic optimiser and it never changes your settings.

It can flag:

- a trial budget that looks thin for the number/type of selected parameters
- missing/invalid numeric ranges
- the current TradingView value falling outside the search range
- extremely wide ranges that may be accidental
- positive ranges spanning 100× or more where logarithmic search may be worth considering
- conditional parameters that will only be active in a small fraction of trials
- approximately how many combinations exist when the whole search space is discrete

The suggested trial range is deliberately approximate. Optuna can solve some spaces with fewer trials and may need substantially more for noisy or highly conditional strategies. Treat it as a configuration sanity check, not a statistical guarantee.

### Parameter search settings

| Option | What it does | When to use it |
| --- | --- | --- |
| **Min / Max** | Defines the search interval for a numeric Pine input. | Keep the interval wide enough to explore meaningfully, but avoid values that make no practical sense for the strategy. |
| **Step (optional)** | Restricts a numeric parameter to discrete increments. Leaving it blank means **Auto**. Auto uses Pine's declared step when TradingView exposes one, otherwise it uses 1 for integers and continuous Optuna search for floats. | Usually leave this on Auto. Set a custom step only when you deliberately want a coarser/finer grid than the Pine input's normal granularity. |
| **Logarithmic search** | Samples a positive numeric range by ratio rather than equal linear distance. This gives similar attention to each order of magnitude. | Use it when sensible values span a large multiplicative range, for example `0.001–1`, `0.1–100` or `1–1000`. Leave it off for narrow ranges, values that can be zero/negative, or parameters where ordinary numeric distance is meaningful. |
| **Categorical choices** | Chooses which boolean or categorical values Optuna may test. | Disable choices you never want the study to consider. |
| **Active when** | Makes one parameter conditional on the value of another boolean/dropdown parameter. | Use when an input only has meaning while a feature or mode is active. This prevents wasting trials on irrelevant combinations. |

#### How Step affects optimisation

Step is not required for Optuna float parameters, but it changes the values Optuna is allowed to try. For example, a range of `0.5–2.0` with step `0.1` is a discrete grid (`0.5, 0.6, 0.7, ...`), while the same float range with no step is continuous and Optuna may try values such as `0.8734`.

The extension therefore defaults Step to **Auto**:

- If TradingView exposes a Pine step, Auto uses that value.
- If no step is exposed for an integer, Auto uses `1`.
- If no step is exposed for a float, Auto leaves the Optuna search continuous.
- Logarithmic float searches are continuous because Optuna does not allow a fixed step together with `log=true`.

In most cases, leave Step blank. Override it only when the strategy has a meaningful custom granularity, such as testing an ATR multiplier strictly in increments of `0.25`.

#### How logarithmic search affects optimisation

A normal numeric search treats equal **differences** as equally spaced. For a range of `1–1000`, values around `900` occupy far more of the linear range than values around `1–10`.

A logarithmic search instead treats equal **ratios** as equally important. Conceptually, a range such as:

```text
1 → 10 → 100 → 1000
```

gets much more balanced exploration across those scales.

Good uses include parameters where a sensible value could plausibly be several times or tens/hundreds of times larger than another sensible value, for example:

- very wide multipliers or thresholds
- regularisation/penalty strengths
- very wide positive sensitivity constants
- positive scale parameters spanning multiple orders of magnitude

Usually leave logarithmic search **off** for:

- ordinary lookback periods such as `10–50`
- ATR periods such as `5–30`
- a multiplier range such as `1.0–4.0`
- values that may be `0` or negative
- any range where a difference of `+1` or `+0.1` has a consistent practical meaning

As a rule of thumb, if the important question is **"2×, 5× or 10× larger?"**, logarithmic search may be appropriate. If the important question is **"+1, +5 or +0.1?"**, use the normal linear search.

Logarithmic search requires a positive minimum. While it is enabled, the extension disables the custom Step field because Optuna float logarithmic search cannot be combined with a fixed step. Logarithmic integer search uses integer values with step `1`.

#### Conditional parameters

**Active when** lets any optimised parameter depend on any Pine boolean or dropdown input. The controller does not need to appear before the child in the Pine settings.

For example, a strategy could define:

```text
Stop-Loss Type = ATR Bars | Percent | Swing H/L

ATR Period          active when Stop-Loss Type = ATR Bars
ATR Multiplier      active when Stop-Loss Type = ATR Bars
Stop-Loss %         active when Stop-Loss Type = Percent
Swing H/L Lookback  active when Stop-Loss Type = Swing H/L
```

This is completely generic; the extension does not know about stop-losses specifically. Any boolean/dropdown can control another parameter. Selecting a controller that is not already being optimised automatically adds it to the search space, because Optuna must be able to sample the controller value for the condition to change between trials.

Controller order in the Pine script does not matter. The extension/backend build a dependency graph and sample controllers before their dependent parameters internally. Circular dependencies are rejected.

The relationship itself is intentionally user-defined. TradingView exposes input names, types and dropdown choices, but it does not reliably expose the Pine logic that says which inputs are used by which dropdown mode, so automatically guessing those relationships could silently create the wrong optimisation search space.

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
| **Full walk-forward re-optimisation** | Creates a completely fresh Optuna study for every chronological fold. Each fold optimises only its training history and then evaluates that fold's winner on the next unseen period. | Use as a stronger, expensive final validation after the basic strategy/search space is already sensible. It tests whether the *optimisation process* continues to work through time rather than only testing one fixed parameter set. |
| **Walk-forward folds** | Number of chronological train → unseen-test cycles. Training expands forward through time. | **3** is a sensible default. More folds provide more regime checks but multiply runtime. |
| **Trials/fold** | Maximum Optuna trials in each independent fold study. | Use enough trials to meaningfully search the space. Total extra optimisation work is roughly **folds × trials/fold**. |
| **Initial train %** | Fraction of the full date range used by the first training window. Later training windows expand. | Around **50%** is a balanced default. Too high leaves little unseen data; too low gives the first optimiser too little history. |
| **Trade-level Monte Carlo** | Bootstrap-resamples the selected result's individual closed trades thousands of times and reports the distribution of cumulative PnL, max drawdown, Profit Factor and negative outcomes. | Use when TradingView exposes a recognised closed-trade list. It adds local CPU work but no extra optimisation trials. |
| **Monte Carlo simulations** | Number of bootstrap paths. | **5,000** is normally enough for a stable summary. Increase it for smoother percentile estimates. |
| **Monte Carlo confidence %** | Central interval shown for cumulative PnL/PF outcomes. | **90%** is a useful default; **95%** is more conservative. |

#### Full walk-forward vs ordinary OOS robustness

The two modes answer different questions:

```text
OOS robustness:
one Optuna study → top parameter sets → several unseen windows

Full walk-forward:
fresh Optuna study in fold 1 → unseen test 1
fresh Optuna study in fold 2 → unseen test 2
fresh Optuna study in fold 3 → unseen test 3
```

Ordinary OOS robustness is much cheaper and asks whether a fixed parameter set generalises. Full walk-forward is stronger and more expensive because it asks whether repeatedly optimising the strategy on only the history available at each point in time continues to produce useful unseen results.

The walk-forward child studies are temporary. Their fold summaries are persisted in the parent experiment, then the temporary Optuna studies are deleted from the local SQLite store.

#### Monte Carlo interpretation

Monte Carlo only runs when the current TradingView report exposes a closed-trade list that the extension can recognise confidently. If that capability is unavailable, the result explicitly says **unavailable**; the extension does not fabricate trades from aggregate Strategy Tester metrics.

The bootstrap samples **absolute trade PnL** with replacement. Therefore cumulative PnL and drawdown are displayed in the same additive PnL units TradingView exposed, not as an invented account-equity percentage.

The reported probability of loss means:

> the percentage of bootstrap resamples of the historical trade sample that ended with negative cumulative PnL.

It is an uncertainty diagnostic for the observed trade sample, **not** a guaranteed probability of future loss.

If OOS robustness has been run, Monte Carlo uses the reserved unseen OOS period. Otherwise it uses the optimisation period and labels itself as an optimisation/in-sample sample.

#### Research evidence verdict

The **Research evidence** card combines only visible evidence areas such as trade sample size, OOS robustness, parameter stability, full walk-forward and Monte Carlo. Each area is labelled **strong**, **moderate**, **weak** or **insufficient**, with the underlying explanation available in the UI.

There is intentionally no opaque numerical score. Missing/unavailable evidence remains visible instead of being silently treated as positive evidence.

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

### Experiment history and reproducibility

Finished runs are retained as compact experiment summaries (up to the most recent 50).

From experiment history you can:

- compare two studies side-by-side
- compare raw best metrics, OOS objective, stability, walk-forward median OOS and Monte Carlo loss frequency
- compare best parameter values
- **Load & edit** a historical setup into the current optimiser form
- **Re-run exact** with a fresh run ID after verifying the same symbol, timeframe and strategy signature are on the current chart
- inspect reproducibility details such as the strategy signature and extension/backend/Optuna versions

Historical runs are never overwritten when re-run.

### TradingView compatibility watchdog

Every normal/resumed study now performs a compatibility pre-flight before the backend study starts. The watchdog checks the critical TradingView integration capabilities used by the optimiser, including chart access, strategy discovery, readable/writable inputs, report source, metrics and strategy signature. Deep Backtesting availability is also required when the run uses it.

During a study the watchdog records the time of the last successful trial. A fatal integration/safety failure changes the watchdog to failed and the optimiser stops safely instead of continuing to submit questionable trials.

Trade-level-data availability is diagnostic rather than critical: normal optimisation still works if Monte Carlo trade extraction is unavailable.

## Architecture

The extension keeps orchestration at a few explicit seams:

- `components/App.tsx` is only the composition shell for the optimiser UI.
- `components/optimiser/useStrategyConfiguration.ts` owns React state for strategy discovery, Pine inputs, presets and run preparation; parameter-editing rules are delegated to the optimisation layer.
- `lib/optimisation/parameter-config.ts` owns parameter draft invariants such as enable/disable behaviour, choices, log/step interaction and conditional-controller relationships.
- `lib/optimisation/search-space.ts` converts the parameter draft into the validated, dependency-ordered Optuna search space and baseline.
- `lib/optimisation/draft.ts` owns the version-tolerant optimisation form model used by saved configurations.
- `lib/optimisation/run-config.ts` converts the UI draft into persisted run configuration, constraints, date ranges and research settings.
- `components/optimiser/useOptimisationRun.ts` owns the persisted optimisation-run lifecycle, resume/recovery, trial sequencing and result actions.
- `components/optimiser/useBackendConnection.ts` owns pairing and localhost backend connection state.
- `components/optimiser/useResearchValidation.ts` owns React state, history persistence and cancellation for post-run research.
- `lib/optimisation/trial-executor.ts` is the shared TradingView trial-evaluation seam used by the normal optimiser and temporary walk-forward studies.
- `lib/optimisation/auxiliary-study-runner.ts` runs temporary Optuna studies through the same authenticated background/backend protocol.
- `lib/optimisation/research-runner.ts` owns fixed-parameter OOS/stability TradingView research execution.
- `lib/optimisation/walk-forward-runner.ts` owns fresh-study chronological walk-forward execution.
- `lib/optimisation/monte-carlo-runner.ts` selects/re-runs the research sample before trade-level Monte Carlo.
- `lib/optimisation/research.ts`, `walk-forward.ts`, `monte-carlo.ts` and `research-verdict.ts` contain pure analysis/ranking/statistical logic.
- `lib/optimisation/search-space-advisor.ts` provides heuristic pre-flight diagnostics without mutating user configuration.
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

Run the backend during development:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

### Windows companion executable

For normal local use the backend can be packaged as a single console executable. The executable runs the same FastAPI/Optuna code and prints the existing pairing code; it does not introduce a second backend implementation.

From the repository root on Windows:

```powershell
pnpm backend:build-companion
```

The output is:

```text
backend\dist\TradeCopy Companion.exe
```

Double-click the executable and keep its console window open while using the extension. When frozen, persistent state is stored under:

```text
%LOCALAPPDATA%\TradeCopy\data
```

PyInstaller is supplied transiently by `uv run --with`, so it is not added to the project's normal runtime dependencies or lockfile.


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

When out-of-sample robustness is enabled, the selected Deep Backtesting range is split before optimisation. Optuna only sees the earlier training portion. After the study finishes, **Run validation** tests the top feasible parameter sets across sequential windows in the reserved unseen portion and ranks them by constraint passes and median OOS objective.

The same validation action then runs any additional enabled research stages in sequence: local stability testing, full fresh-study walk-forward, and trade-level Monte Carlo. All stages are cancellable. Temporary walk-forward studies reuse the normal TradingView trial safety path and are deleted after their fold summaries have been captured.

Stability validation perturbs each numeric optimised parameter around the selected winner and re-runs TradingView to identify sharp, fragile optima. Parameter importance is calculated on the persisted Optuna study using PED-ANOVA.

Experiment history stores compact summaries for the most recent 50 completed/stopped studies rather than duplicating every historical trial in browser storage.
