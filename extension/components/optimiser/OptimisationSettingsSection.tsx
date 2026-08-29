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
  const locked = activeRunId !== null;
  const { form } = model;

  return (
    <section>
      <strong>Optimisation</strong>

      <div className="fieldGrid">
        <label>
          <span>Metric</span>
          <select
            value={form.objectiveMetric}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                objectiveMetric:
                  event.target.value,
              })
            }
          >
            {OPTIMISATION_METRICS.map(
              (metric) => (
                <option
                  key={metric.key}
                  value={metric.key}
                >
                  {metric.label}
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>Trials</span>
          <input
            type="number"
            min="1"
            max="100000"
            value={form.targetTrials}
            disabled={locked}
            onChange={(event) =>
              model.updateForm({
                targetTrials:
                  event.target.value,
              })
            }
          />
        </label>
      </div>

      <div className="subsection">
        <label className="toggleRow">
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
          <span>
            Custom Deep Backtesting range
          </span>
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
                    startDate:
                      event.target.value,
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
                    endDate:
                      event.target.value,
                  })
                }
              />
            </label>
          </div>
        )}
      </div>

      <div className="filterList">
        <label className="filterRow">
          <input
            type="checkbox"
            checked={
              form.maxDrawdownFilter.enabled
            }
            disabled={locked}
            onChange={(event) =>
              model.updateFilter(
                'maxDrawdownFilter',
                {
                  enabled:
                    event.target.checked,
                },
              )
            }
          />
          <span>Max drawdown %</span>
          <input
            type="number"
            value={
              form.maxDrawdownFilter.value
            }
            disabled={
              locked ||
              !form.maxDrawdownFilter.enabled
            }
            onChange={(event) =>
              model.updateFilter(
                'maxDrawdownFilter',
                {
                  value: event.target.value,
                },
              )
            }
          />
        </label>

        <label className="filterRow">
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
                  enabled:
                    event.target.checked,
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
                {
                  value: event.target.value,
                },
              )
            }
          />
        </label>

        <label className="filterRow">
          <input
            type="checkbox"
            checked={
              form.minTradesFilter.enabled
            }
            disabled={locked}
            onChange={(event) =>
              model.updateFilter(
                'minTradesFilter',
                {
                  enabled:
                    event.target.checked,
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
                {
                  value: event.target.value,
                },
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
