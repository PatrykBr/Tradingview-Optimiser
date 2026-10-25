# Research and results

[README](../README.md) · [Optimisation settings](optimisation.md)

Research checks are optional. Enable the checks you want before starting a study. After optimisation finishes, click **Run validation**. Validation runs the enabled stages in sequence, and you can cancel it.

## Choose a check

| Check                    | What it tests                                                         | Extra work                                                             |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Out-of-sample robustness | How top parameter sets perform on reserved unseen data.               | About one backtest per candidate per fold.                             |
| Parameter stability      | How nearby numeric parameter values affect the selected result.       | Backtests for the parameter variations.                                |
| Full walk-forward        | How repeated optimisation performs as more history becomes available. | A fresh study and an unseen test for each fold.                        |
| Trade-level Monte Carlo  | How resampling the observed closed trades changes the result.         | Local computation and any backtest needed to load the selected sample. |

Out-of-sample validation, walk-forward and Monte Carlo require a custom Deep Backtesting range. Monte Carlo also requires a recognised closed-trade list in the TradingView report.

## Stop when converged

Convergence stopping ends a study when its best feasible objective has not improved enough within the configured trial window.

| Setting       | Effect                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Min trials    | Number of completed trials required before convergence can stop the study.                          |
| Patience      | Number of trials allowed without sufficient improvement. Larger values allow more exploration.      |
| Min improve % | Improvement required to reset the convergence window. Lower values count smaller gains as progress. |

The form starts at 50 minimum trials, 30 trials of patience and 1% minimum improvement.

Use convergence stopping for larger budgets. A short run may stop before it has explored much of the search space.

## Reserve unseen data

Out-of-sample validation, or OOS validation, reserves the final part of the Deep Backtesting range before optimisation starts. Optuna sees only the earlier training period. Validation then tests the top feasible candidates across sequential windows in the reserved period.

| Setting    | Effect                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OOS %      | Percentage of the date range reserved for validation. A larger share leaves less training history.                                                                      |
| Folds      | Number of sequential validation windows. More folds add backtests and shorten each window.                                                                              |
| Candidates | Number of distinct feasible parameter sets to validate. Reused trials do not take additional candidate slots. Backtest count grows with candidates multiplied by folds. |

The form starts with 30% OOS data, 3 folds and 5 candidates.

Each validation or walk-forward test fold needs at least two calendar days. Invalid dates and splits that leave shorter folds are rejected before optimisation starts.

The robust winner ranks first by the number of folds that pass the filters, then by the median OOS objective. It may have a lower training objective than the original best trial.

Degradation measures the drop in objective between training and validation. A negative value means the candidate performed better out of sample.

## Test nearby parameter values

The stability test changes each numeric optimised parameter near the selected winner and repeats the backtest. **Perturbation %** sets the distance as a percentage of that parameter's full search range. The form starts at 5%.

| Rating   | Meaning                                                   |
| -------- | --------------------------------------------------------- |
| Strong   | Nearby changes cause little degradation.                  |
| Moderate | Nearby values weaken performance.                         |
| Fragile  | Small changes cause large degradation or filter failures. |

Choose a perturbation size that represents a meaningful change for the parameter. A small variation relative to the full range can still be a large change near one end of it.

## Run full walk-forward studies

OOS validation tests fixed parameter sets after one optimisation. Full walk-forward creates a fresh Optuna study for each chronological fold. Each study uses only the history available at that point, then tests its winner on the next unseen period.

| Setting            | Effect                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Walk-forward folds | Number of training and unseen-test cycles.                                                                             |
| Trials/fold        | Trial budget for each independent study. Total extra optimisation work is roughly folds multiplied by trials per fold. |
| Initial train %    | Share of the full range used by the first training window. Later windows expand as history becomes available.          |

The form starts with 3 folds, 100 trials per fold and a 50% initial training window.

Walk-forward tests the repeated optimisation process. It can require many more backtests than fixed-parameter validation. The backend deletes temporary fold studies after saving their summaries in the parent experiment.

## Interpret Monte Carlo results

Monte Carlo samples closed-trade PnL values with replacement and calculates cumulative PnL, maximum drawdown, profit factor and the frequency of negative outcomes.

| Setting                  | Effect                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Monte Carlo simulations  | Number of bootstrap paths. More paths use more CPU time and make percentile estimates smoother.   |
| Monte Carlo confidence % | Central interval reported for the simulated outcomes. A higher percentage gives a wider interval. |

The form starts with 5,000 simulations and a 90% interval.

PnL and drawdown use the same additive units as the TradingView trade data. They are not account-equity percentages. The reported probability of loss is the share of resampled historical trade sequences that finish with negative cumulative PnL. These resamples describe the observed trade sample. They do not establish the probability of future losses.

When OOS validation has run, Monte Carlo uses the reserved unseen period. If only walk-forward results are available, it uses the final fold's unseen test period. Otherwise, it uses the optimisation period and labels the sample as in-sample. If TradingView does not expose a recognised trade list, the result reports that Monte Carlo is unavailable. It does not derive trades from aggregate metrics.

## Read parameter importance and evidence

Optuna PED-ANOVA calculates parameter importance when enough feasible trials are available. A larger percentage means the parameter had more influence on reaching the study's better-performing region. Low-importance parameters may be candidates to fix or remove in a later study. Importance does not prove causality.

The **Research evidence** card rates the trade sample, OOS results, stability, walk-forward and Monte Carlo evidence. Each area has an explanation and a rating of strong, moderate, weak or insufficient. Missing checks do not count as positive evidence. Monte Carlo on an in-sample trade list contributes at most moderate evidence.

## Experiment history

The extension keeps summaries for the most recent 50 finished runs. It stores full trial history in the backend's Optuna study rather than copying every past trial into browser storage.

From history, you can:

- Compare two runs' metrics, parameter values and research results side by side.
- Use **Load & edit** to copy a historical setup into the form.
- Use **Re-run exact** to start a new run after checking the symbol, timeframe and strategy signature.
- Inspect the strategy signature and extension, backend and Optuna versions.

Re-running an experiment creates a new run ID and preserves the original record.
