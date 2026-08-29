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
        <label title="The TradingView performance metric Optuna will optimise. Choose the metric that best represents your actual goal; filters can constrain the other metrics.">
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

        <label title="Maximum number of Optuna trials. More trials explore the search space more thoroughly but take longer. Convergence stopping can end the study earlier.">
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
          title="Use TradingView Deep Backtesting over a fixed date range. Required for out-of-sample robustness. Use this when you want reproducible historical periods rather than the current chart session."
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
          title="Stop the Optuna study early when the best feasible objective has not improved enough for the configured patience window. Useful for large trial budgets where the study may converge well before the maximum."
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
              Saves time on large studies by stopping after sustained lack of meaningful improvement.
            </p>
            <div className="researchGrid">
            <label title="The study cannot stop for convergence before this many completed trials. Keep this high enough for Optuna to explore the search space first.">
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
            <label title="Number of recent completed trials allowed without enough improvement before the study is considered converged. Larger values are more conservative.">
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
            <label title="Minimum percentage improvement in the best feasible objective needed to reset the convergence window. Lower values demand smaller improvements and therefore tend to run longer.">
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
          title="Reserve the final part of the Deep Backtesting range as unseen data. After optimisation, re-test the top feasible candidates across sequential out-of-sample windows and rank them by robustness."
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
              <label title="Percentage of the full Deep Backtesting range kept completely unseen during optimisation. 20–30% is a good default; higher values strengthen validation but leave less data for training.">
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
              <label title="Number of sequential validation windows in the unseen period. Three folds is a good default for checking performance across different market regimes.">
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
              <label title="How many of the best feasible Optuna trials to re-test out of sample. More candidates reduce the chance of choosing one lucky in-sample winner but add candidates × folds extra TradingView backtests.">
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
          title="After optimisation, perturb each numeric parameter around the selected winner and re-test it. Use this to detect sharp peaks where tiny parameter changes destroy performance."
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
              Checks whether the winner sits on a broad stable plateau instead of a fragile parameter spike.
            </p>
            <div className="researchGrid singleResearchField">
            <label title="How far to move each numeric parameter, expressed as a percentage of that parameter's full search range. Around 5% is a sensible default.">
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
      </div>

      <div className="filterList">
        <label
          className="filterRow"
          title="Constraint only: trials above this TradingView maximum drawdown percentage are considered infeasible. This does not become the optimisation objective."
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
          title="Constraint only: trials below this Profit Factor are considered infeasible. Useful when optimising another metric while enforcing a minimum strategy quality."
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
          title="Constraint only: trials with fewer trades are considered infeasible. Use it to avoid selecting impressive metrics produced by an unrealistically small sample."
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
