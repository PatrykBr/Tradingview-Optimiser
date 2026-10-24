# Optimisation settings

[README](../README.md) · [Research guide](research.md)

## Choose an objective and filters

Optuna optimises one TradingView metric. Filters set requirements for the other metrics. A feasible trial passes every enabled filter.

| Setting | Effect |
| --- | --- |
| Metric | Selects the performance metric to maximise or minimise. |
| Max trials | Limits the number of Optuna trials. Start with 5 to 20 trials to check the setup. |
| Custom Deep Backtesting range | Uses a fixed historical period. Requires TradingView Deep Backtesting access. |
| Max drawdown % | Rejects trials above the drawdown limit. |
| Min profit factor | Rejects trials below the profit factor limit. |
| Min trades | Rejects trials with too few trades. |

Filters do not add objectives. A trial can have the highest objective value and still fail a filter.

The extension uses the current strategy settings for the baseline trial when they fit the search space.

## Set parameter ranges

| Setting | Effect |
| --- | --- |
| Min / Max | Sets the numeric search interval. Choose values that make sense for the strategy. |
| Step | Restricts numeric values to fixed increments. Leave it blank for Auto. |
| Logarithmic search | Samples a positive range by ratio. Useful when values span several orders of magnitude. |
| Categorical choices | Selects the boolean or dropdown values Optuna may test. |
| Active when | Samples a parameter only when its controller has a selected value. |

### Step and Auto

A range of `0.5` to `2.0` with step `0.1` allows values such as `0.5`, `0.6` and `0.7`. A continuous float search can also try values such as `0.8734`.

Auto resolves the step as follows:

| Input | Auto behaviour |
| --- | --- |
| Pine declares a step that TradingView exposes | Uses the declared step. |
| Integer with no declared step | Uses `1`. |
| Float with no declared step | Uses continuous sampling. |
| Logarithmic float | Uses continuous sampling. A fixed step cannot accompany `log=true`. |
| Logarithmic integer | Uses integer values with step `1`. |

Override Auto when the strategy needs a specific increment, such as testing an ATR multiplier in steps of `0.25`.

### Logarithmic search

Linear sampling gives equal weight to equal differences. Logarithmic sampling gives equal weight to equal ratios. In a range of `1` to `1000`, logarithmic sampling allocates comparable attention to `1` to `10`, `10` to `100` and `100` to `1000`.

Use it for positive multipliers or thresholds that span several orders of magnitude, such as `0.001` to `1`. Linear sampling usually suits narrower ranges, such as a lookback of `10` to `50` or an ATR multiplier of `1` to `4`.

Logarithmic search requires a positive minimum. The extension disables the custom Step field while it is on.

### Conditional parameters

Use **Active when** when an input matters only in a particular mode. For example:

| Parameter | Active when Stop-Loss Type is |
| --- | --- |
| ATR Period | ATR Bars |
| ATR Multiplier | ATR Bars |
| Stop-Loss % | Percent |
| Swing H/L Lookback | Swing H/L |

Any Pine boolean or dropdown can control another parameter. Selecting a controller adds it to the search space if it is not already enabled. The backend samples controllers before their dependent parameters, regardless of their order in the Pine script. It rejects circular dependencies.

You define these relationships. TradingView exposes input names, types and choices, but does not reliably expose the Pine logic that determines which inputs each mode uses.

## Review the pre-flight check

Expand **Pre-flight check** in the parameter section to review ranges and the trial budget. It checks for:

- Missing or invalid numeric ranges.
- Current values outside the search range.
- Unusually wide ranges and positive ranges that may suit logarithmic sampling.
- Conditional parameters that may receive few active trials.
- Trial budgets below its estimate for the selected parameters.

For discrete spaces, it also estimates the number of combinations before accounting for conditional branches. The suggested trial range is a heuristic. It does not change your configuration or guarantee enough trials for a noisy strategy.

## Understand trial reuse

Optuna may suggest the same complete parameter set more than once. Conditional parameters can also make several apparent combinations equivalent when some inputs are inactive.

Within a persisted study, the backend reuses the objective, metrics and constraints from the earliest matching completed trial. It completes the new Optuna trial without sending another TradingView backtest. Progress, experiment comparisons and exports identify reused trials.

For a finite search space, the backend counts the reachable parameter sets, including conditional branches, when the count fits within the trial budget. Once it has evaluated every set, the study ends with **Search space exhausted**. Continuous float spaces continue to use normal Optuna sampling.

Reuse stays within one study. The backend does not share results across experiments, symbols, timeframes, strategy signatures or date ranges.

## Save a configuration

Named configurations store parameter settings and the optimisation form for an exact strategy version. Reload the inputs after changing the strategy before saving or loading a configuration.

For finished runs, [experiment history](research.md#experiment-history) also lets you load a setup for editing or re-run it as a new experiment.
