import { OPTIMISATION_METRICS } from '../../lib/optimisation/metrics';
import type { StrategyConfigurationModel } from './useStrategyConfiguration';

interface OptimisationSettingsSectionProps {
  model: StrategyConfigurationModel;
  activeRunId: string | null;
  connected: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function OptimisationSettingsSection({
  model,
  activeRunId,
  connected,
  busy,
  onStart,
  onStop,
}: OptimisationSettingsSectionProps) {
  const locked =
    activeRunId !== null || busy;
  const { form } = model;

  return (
    <section>
      <strong>Optimisation</strong>

      <div className="fieldGrid">
        <label title="Choose the TradingView metric to optimise. Use filters to set limits on other metrics.">
          <span>Metric</span>
          <select
            value={form.objectiveMetric}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                objectiveMetric: event.target.value,
              })
            }
          >
            {OPTIMISATION_METRICS.map((metric) => (
              <option
                key={metric.key}
                value={metric.key}
              >
                {metric.label}
              </option>
            ))}
          </select>
        </label>

        <label title="Limit the number of Optuna trials. More trials take longer. Convergence stopping can end the study early.">
          <span>Max trials</span>
          <input
            type="number"
            min="1"
            max="100000"
            value={form.targetTrials}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                targetTrials: event.target.value,
              })
            }
          />
        </label>
      </div>

      <div className="subsection">
        <label
          className="toggleRow"
          title="Run Deep Backtesting over a fixed date range. Required for out-of-sample validation, walk-forward and Monte Carlo."
        >
          <input
            type="checkbox"
            checked={form.dateRangeEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                dateRangeEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Custom Deep Backtesting range</span>
        </label>

        {form.dateRangeEnabled && (
          <div className="dateGrid">
            <label>
              <span>From</span>
              <input
                type="date"
                value={form.startDate}
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    startDate: event.target.value,
                  })
                }
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={form.endDate}
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    endDate: event.target.value,
                  })
                }
              />
            </label>
          </div>
        )}
      </div>

      <div className="subsection researchSettings">
        <div className="rowLabel">
          <strong>Research</strong>
          <span className="muted">optional</span>
        </div>

        <label
          className="toggleRow"
          title="Stop when the best feasible objective has not improved enough within the patience window."
        >
          <input
            type="checkbox"
            checked={form.convergenceEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                convergenceEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Stop when converged</span>
        </label>

        {form.convergenceEnabled && (
          <>
            <p className="helpText researchHint">
              Stops after the best feasible result has stopped improving by the required amount.
            </p>
            <div className="researchGrid">
            <label title="Complete at least this many trials before convergence can stop the study.">
              <span>Min trials</span>
              <input
                type="number"
                min="5"
                value={form.convergenceMinTrials}
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    convergenceMinTrials:
                      event.target.value,
                  })
                }
              />
            </label>
            <label title="Allow this many trials without sufficient improvement before stopping. Increase it to allow more exploration.">
              <span>Patience</span>
              <input
                type="number"
                min="5"
                value={form.convergencePatience}
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    convergencePatience:
                      event.target.value,
                  })
                }
              />
            </label>
            <label title="Percentage improvement required to reset the convergence window. Lower values count smaller gains as progress.">
              <span>Min improve %</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={
                  form.convergenceMinImprovementPercent
                }
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    convergenceMinImprovementPercent:
                      event.target.value,
                  })
                }
              />
            </label>
          </div>
          </>
        )}

        <label
          className="toggleRow"
          title="Reserve the final part of the date range for validation. After optimisation, test the top feasible candidates on those unseen windows."
        >
          <input
            type="checkbox"
            checked={form.robustnessEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                robustnessEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Out-of-sample robustness</span>
        </label>

        {form.robustnessEnabled && (
          <>
            <p className="helpText researchHint">
              Reserves the final part of your Deep
              Backtesting range for unseen validation.
            </p>
            <div className="researchGrid">
              <label title="Percentage of the date range reserved for validation. A larger share leaves less training history.">
                <span>OOS %</span>
                <input
                  type="number"
                  min="10"
                  max="50"
                  value={
                    form.robustnessValidationPercent
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      robustnessValidationPercent:
                        event.target.value,
                    })
                  }
                />
              </label>
              <label title="Split the unseen period into this many sequential validation windows. More folds add backtests and shorten each window.">
                <span>Folds</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={form.robustnessFolds}
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      robustnessFolds:
                        event.target.value,
                    })
                  }
                />
              </label>
              <label title="Number of top feasible trials to validate. Expect about one extra backtest per candidate per fold.">
                <span>Candidates</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={
                    form.robustnessTopCandidates
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      robustnessTopCandidates:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </>
        )}

        <label
          className="toggleRow"
          title="Change each numeric parameter near the selected winner and repeat the backtest to check its sensitivity."
        >
          <input
            type="checkbox"
            checked={form.stabilityEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                stabilityEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Best-parameter stability test</span>
        </label>

        {form.stabilityEnabled && (
          <>
            <p className="helpText researchHint">
              Checks how small parameter changes affect the selected result.
            </p>
            <div className="researchGrid singleResearchField">
            <label title="Distance to move each numeric parameter, as a percentage of its full search range.">
              <span>Perturbation %</span>
              <input
                type="number"
                min="0.1"
                max="25"
                step="0.1"
                value={
                  form.stabilityPerturbationPercent
                }
                disabled={locked}
                onChange={(event) =>
                  model.updateForm({
                    stabilityPerturbationPercent:
                      event.target.value,
                  })
                }
              />
            </label>
          </div>
          </>
        )}

        <label
          className="toggleRow"
          title="Run a fresh study for each chronological fold. Test each winner on the next unseen period. Each fold adds optimisation trials and a validation backtest."
        >
          <input
            type="checkbox"
            checked={form.walkForwardEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                walkForwardEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Full walk-forward re-optimisation</span>
        </label>

        {form.walkForwardEnabled && (
          <>
            <p className="helpText researchHint">
              Tests whether repeated optimisation produces useful results on later unseen periods.
            </p>
            <div className="researchGrid">
              <label title="Number of training and unseen-test cycles. More folds add optimisation trials.">
                <span>Folds</span>
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={form.walkForwardFolds}
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      walkForwardFolds:
                        event.target.value,
                    })
                  }
                />
              </label>
              <label title="Trial budget for each fold. Total extra optimisation work is roughly folds multiplied by trials per fold.">
                <span>Trials/fold</span>
                <input
                  type="number"
                  min="5"
                  max="10000"
                  value={
                    form.walkForwardTrialsPerFold
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      walkForwardTrialsPerFold:
                        event.target.value,
                    })
                  }
                />
              </label>
              <label title="Percentage of the date range used for the first training window. Later folds include more history.">
                <span>Initial train %</span>
                <input
                  type="number"
                  min="30"
                  max="80"
                  value={
                    form.walkForwardInitialTrainingPercent
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      walkForwardInitialTrainingPercent:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </>
        )}

        <label
          className="toggleRow"
          title="Resample observed closed trades to estimate profit factor, cumulative PnL and drawdown distributions. Requires a recognised TradingView trade list."
        >
          <input
            type="checkbox"
            checked={form.monteCarloEnabled}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                monteCarloEnabled:
                  event.target.checked,
              })
            }
          />
          <span>Trade-level Monte Carlo</span>
        </label>

        {form.monteCarloEnabled && (
          <>
            <p className="helpText researchHint">
              Resamples closed trades. Reports unavailable if TradingView does not expose a recognised trade list.
            </p>
            <div className="researchGrid">
              <label title="Number of bootstrap paths. More paths make percentile estimates smoother and use more CPU time.">
                <span>Simulations</span>
                <input
                  type="number"
                  min="500"
                  max="50000"
                  value={
                    form.monteCarloSimulations
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      monteCarloSimulations:
                        event.target.value,
                    })
                  }
                />
              </label>
              <label title="Central interval reported for simulated outcomes. A higher percentage gives a wider interval.">
                <span>Confidence %</span>
                <input
                  type="number"
                  min="50"
                  max="99"
                  value={
                    form.monteCarloConfidencePercent
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      monteCarloConfidencePercent:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div className="filterList">
        <label
          className="filterRow"
          title="Reject trials above this maximum drawdown percentage."
        >
          <input
            type="checkbox"
            checked={form.maxDrawdownFilter.enabled}
            disabled={locked}
            onChange={(event) =>
              model.updateFilter(
                'maxDrawdownFilter',
                {
                  enabled: event.target.checked,
                },
              )
            }
          />
          <span>Max drawdown %</span>
          <input
            type="number"
            value={form.maxDrawdownFilter.value}
            disabled={
              locked ||
              !form.maxDrawdownFilter.enabled
            }
            onChange={(event) =>
              model.updateFilter(
                'maxDrawdownFilter',
                { value: event.target.value },
              )
            }
          />
        </label>

        <label
          className="filterRow"
          title="Reject trials below this profit factor."
        >
          <input
            type="checkbox"
            checked={
              form.minProfitFactorFilter.enabled
            }
            disabled={locked}
            onChange={(event) =>
              model.updateFilter(
                'minProfitFactorFilter',
                {
                  enabled: event.target.checked,
                },
              )
            }
          />
          <span>Min profit factor</span>
          <input
            type="number"
            step="0.01"
            value={
              form.minProfitFactorFilter.value
            }
            disabled={
              locked ||
              !form.minProfitFactorFilter.enabled
            }
            onChange={(event) =>
              model.updateFilter(
                'minProfitFactorFilter',
                { value: event.target.value },
              )
            }
          />
        </label>

        <label
          className="filterRow"
          title="Reject trials with fewer than this many trades."
        >
          <input
            type="checkbox"
            checked={form.minTradesFilter.enabled}
            disabled={locked}
            onChange={(event) =>
              model.updateFilter(
                'minTradesFilter',
                {
                  enabled: event.target.checked,
                },
              )
            }
          />
          <span>Min trades</span>
          <input
            type="number"
            value={form.minTradesFilter.value}
            disabled={
              locked ||
              !form.minTradesFilter.enabled
            }
            onChange={(event) =>
              model.updateFilter(
                'minTradesFilter',
                { value: event.target.value },
              )
            }
          />
        </label>
      </div>

      {activeRunId === null ? (
        <button
          className="primary"
          disabled={
            !connected ||
            busy ||
            model.selectedInputCount === 0
          }
          onClick={onStart}
        >
          {busy
            ? 'Preparing…'
            : 'Start optimisation'}
        </button>
      ) : (
        <button
          className="danger"
          onClick={onStop}
        >
          Stop optimisation
        </button>
      )}
    </section>
  );
}
