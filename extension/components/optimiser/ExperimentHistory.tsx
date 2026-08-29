import { useMemo, useState } from 'react';

import { formatMetric } from '../../lib/optimisation/metrics';
import type {
  ExperimentRecord,
} from '../../lib/optimisation/storage';
import type {
  CreateRun,
} from '../../lib/protocol/types';

interface ExperimentHistoryProps {
  experiments: ExperimentRecord[];
  busy: boolean;
  connected: boolean;
  activeRunId: string | null;
  inputLabel: (
    id: string,
  ) => string;
  onLoadExperiment(
    config: CreateRun,
  ): Promise<void>;
  onRerunExperiment(
    config: CreateRun,
  ): Promise<void>;
  onRemoveExperiment(
    runId: string,
  ): Promise<void>;
}

const experimentTerminationLabel = (
  experiment: ExperimentRecord,
): string => {
  switch (experiment.terminationReason) {
    case 'target_trials':
      return 'Target reached';
    case 'converged':
      return 'Converged';
    case 'search_space_exhausted':
      return 'Search space exhausted';
    case 'user':
      return 'Stopped by user';
    default:
      return experiment.status;
  }
};

const experimentLabel = (
  experiment: ExperimentRecord,
): string => {
  const date = new Date(
    experiment.finishedAt,
  ).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    date +
    ' · ' +
    experiment.config.chart.strategy_name +
    ' · #' +
    experiment.runId.slice(0, 6)
  );
};

const comparisonResearchValue = (
  experiment: ExperimentRecord | undefined,
  key:
    | 'oos'
    | 'stability'
    | 'walk-forward'
    | 'monte-carlo',
): string => {
  if (!experiment?.research) return '—';

  if (key === 'oos') {
    const winner =
      experiment.research.robustness
        ?.candidates[0];

    if (
      !winner ||
      winner.validationObjective === null
    ) {
      return '—';
    }

    return formatMetric(
      experiment.config.objective_metric,
      winner.validationObjective,
    );
  }

  if (key === 'stability') {
    return (
      experiment.research.stability
        ?.overallRating ?? '—'
    );
  }

  if (key === 'walk-forward') {
    const value =
      experiment.research.walkForward
        ?.medianTestObjective;

    return typeof value === 'number'
      ? formatMetric(
          experiment.config
            .objective_metric,
          value,
        )
      : '—';
  }

  const lossProbability =
    experiment.research.monteCarlo
      ?.probabilityOfLoss;

  return typeof lossProbability ===
      'number'
    ? (
        lossProbability * 100
      ).toFixed(1) + '% loss'
    : '—';
};

const comparisonValue = (
  experiment: ExperimentRecord | undefined,
  key: string,
): string => {
  if (!experiment?.best) return '—';

  if (key === 'objective') {
    return formatMetric(
      experiment.config.objective_metric,
      experiment.best.objective_value,
    );
  }

  const value =
    experiment.best.metrics[key];

  return typeof value === 'number' &&
    Number.isFinite(value)
    ? formatMetric(key, value)
    : '—';
};

const comparisonRows = [
  {
    label: 'Objective',
    key: 'objective',
  },
  {
    label: 'Profit Factor',
    key: 'profitFactor',
  },
  {
    label: 'Net Profit %',
    key: 'netProfitPercent',
  },
  {
    label: 'Max DD %',
    key: 'maxDrawdownPercent',
  },
  {
    label: 'Trades',
    key: 'totalTrades',
  },
];

export default function ExperimentHistory({
  experiments,
  busy,
  connected,
  activeRunId,
  inputLabel,
  onLoadExperiment,
  onRerunExperiment,
  onRemoveExperiment,
}: ExperimentHistoryProps) {
  const [leftRunId, setLeftRunId] =
    useState('');
  const [rightRunId, setRightRunId] =
    useState('');

  const left = experiments.find(
    (experiment) =>
      experiment.runId === leftRunId,
  );
  const right = experiments.find(
    (experiment) =>
      experiment.runId === rightRunId,
  );

  const comparisonParameters = useMemo(
    () => {
      if (!left || !right) return [];

      return [
        ...new Set([
          ...Object.keys(
            left.best?.parameters ?? {},
          ),
          ...Object.keys(
            right.best?.parameters ?? {},
          ),
        ]),
      ].slice(0, 20);
    },
    [left, right],
  );

  if (experiments.length === 0) {
    return null;
  }

  return (
    <details className="experimentHistory">
      <summary>
        Experiments ({experiments.length})
      </summary>

      <div className="experimentCompare">
        <select
          value={leftRunId}
          onChange={(event) =>
            setLeftRunId(
              event.target.value,
            )
          }
        >
          <option value="">
            Compare run…
          </option>
          {experiments.map(
            (experiment) => (
              <option
                key={experiment.runId}
                value={experiment.runId}
              >
                {experimentLabel(
                  experiment,
                )}
              </option>
            ),
          )}
        </select>

        <select
          value={rightRunId}
          onChange={(event) =>
            setRightRunId(
              event.target.value,
            )
          }
        >
          <option value="">
            With run…
          </option>
          {experiments.map(
            (experiment) => (
              <option
                key={experiment.runId}
                value={experiment.runId}
              >
                {experimentLabel(
                  experiment,
                )}
              </option>
            ),
          )}
        </select>
      </div>

      {left && right && (
        <div className="comparisonTable">
          <div className="comparisonHeader">
            <span />
            <strong>Run A</strong>
            <strong>Run B</strong>
          </div>

          {comparisonRows.map((row) => (
            <div
              className="comparisonRow"
              key={row.key}
            >
              <span>{row.label}</span>
              <code>
                {comparisonValue(
                  left,
                  row.key,
                )}
              </code>
              <code>
                {comparisonValue(
                  right,
                  row.key,
                )}
              </code>
            </div>
          ))}

          <div className="comparisonRow">
            <span>OOS objective</span>
            <code>
              {comparisonResearchValue(
                left,
                'oos',
              )}
            </code>
            <code>
              {comparisonResearchValue(
                right,
                'oos',
              )}
            </code>
          </div>

          <div className="comparisonRow">
            <span>Stability</span>
            <code>
              {comparisonResearchValue(
                left,
                'stability',
              )}
            </code>
            <code>
              {comparisonResearchValue(
                right,
                'stability',
              )}
            </code>
          </div>

          <div className="comparisonRow">
            <span>WF median OOS</span>
            <code>
              {comparisonResearchValue(
                left,
                'walk-forward',
              )}
            </code>
            <code>
              {comparisonResearchValue(
                right,
                'walk-forward',
              )}
            </code>
          </div>

          <div className="comparisonRow">
            <span>MC probability</span>
            <code>
              {comparisonResearchValue(
                left,
                'monte-carlo',
              )}
            </code>
            <code>
              {comparisonResearchValue(
                right,
                'monte-carlo',
              )}
            </code>
          </div>

          <div className="comparisonRow">
            <span>Trials</span>
            <code>
              {left.completedTrials}
            </code>
            <code>
              {right.completedTrials}
            </code>
          </div>

          <div className="comparisonRow">
            <span>Reused trials</span>
            <code>
              {left.reusedTrials ?? 0}
            </code>
            <code>
              {right.reusedTrials ?? 0}
            </code>
          </div>

          <div className="comparisonRow">
            <span>Stopped by</span>
            <code>
              {experimentTerminationLabel(
                left,
              )}
            </code>
            <code>
              {experimentTerminationLabel(
                right,
              )}
            </code>
          </div>

          {comparisonParameters.length > 0 && (
            <div className="comparisonDivider">
              Best parameters
            </div>
          )}

          {comparisonParameters.map(
            (parameter) => (
              <div
                className="comparisonRow"
                key={parameter}
              >
                <span>
                  {inputLabel(parameter)}
                </span>
                <code>
                  {String(
                    left.best?.parameters[
                      parameter
                    ] ?? '—',
                  )}
                </code>
                <code>
                  {String(
                    right.best?.parameters[
                      parameter
                    ] ?? '—',
                  )}
                </code>
              </div>
            ),
          )}
        </div>
      )}

      {left && (
        <details className="experimentMeta">
          <summary>
            Reproducibility details
          </summary>
          <div className="metricsList">
            <div>
              <span>Symbol</span>
              <code>
                {left.config.chart.symbol}
              </code>
            </div>
            <div>
              <span>Timeframe</span>
              <code>
                {left.config.chart.timeframe}
              </code>
            </div>
            <div>
              <span>Strategy signature</span>
              <code
                title={
                  left.config.chart
                    .strategy_signature
                }
              >
                {left.config.chart
                  .strategy_signature.slice(
                    0,
                    18,
                  )}
                …
              </code>
            </div>
            <div>
              <span>Date range</span>
              <code>
                {left.config.backtest_range
                  ? left.config
                      .backtest_range
                      .start_date +
                    ' → ' +
                    left.config
                      .backtest_range
                      .end_date
                  : 'Chart session'}
              </code>
            </div>
            <div>
              <span>Search parameters</span>
              <code>
                {
                  left.config.parameters
                    .length
                }
              </code>
            </div>
            <div>
              <span>Constraints</span>
              <code>
                {left.config.filters.length}
              </code>
            </div>
            <div>
              <span>Extension</span>
              <code>
                {left.environment
                  ?.extensionVersion ??
                  'legacy'}
              </code>
            </div>
            <div>
              <span>Backend</span>
              <code>
                {left.environment
                  ?.backendVersion ??
                  'legacy'}
              </code>
            </div>
            <div>
              <span>Optuna</span>
              <code>
                {left.environment
                  ?.optunaVersion ??
                  'legacy'}
              </code>
            </div>
          </div>
        </details>
      )}

      {left && (
        <div className="experimentActions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onLoadExperiment(
                left.config,
              )
            }
          >
            Load & edit
          </button>
          <button
            className="secondary"
            disabled={
              busy ||
              !connected ||
              activeRunId !== null
            }
            onClick={() =>
              void onRerunExperiment(
                left.config,
              )
            }
          >
            Re-run exact
          </button>
          <button
            className="textButton experimentDelete"
            disabled={busy}
            onClick={() =>
              void onRemoveExperiment(
                left.runId,
              ).then(() =>
                setLeftRunId(''),
              )
            }
          >
            Delete
          </button>
        </div>
      )}
    </details>
  );
}
