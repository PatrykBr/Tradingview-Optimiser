import { useMemo, useState } from 'react';

import {
  formatMetric,
  metricDefinition,
} from '../../lib/optimisation/metrics';
import type { ExperimentRecord } from '../../lib/optimisation/storage';
import type { ResearchValidationModel } from './useResearchValidation';
import type { OptimisationRunModel } from './useOptimisationRun';

interface ResearchSectionProps {
  run: OptimisationRunModel;
  research: ResearchValidationModel;
  inputLabel: (id: string) => string;
}

const terminal = (
  status: string | undefined,
): boolean =>
  status === 'completed' ||
  status === 'stopped' ||
  status === 'failed';

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
    experiment.config.chart.strategy_name
  );
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
  return Number.isFinite(value)
    ? formatMetric(key, value!)
    : '—';
};

export default function ResearchSection({
  run,
  research,
  inputLabel,
}: ResearchSectionProps) {
  const [leftRunId, setLeftRunId] =
    useState('');
  const [rightRunId, setRightRunId] =
    useState('');

  const currentResearch =
    run.runConfig?.research;
  const canValidate =
    terminal(run.progress?.status) &&
    Boolean(run.progress?.best) &&
    Boolean(
      currentResearch?.robustness.enabled ||
        currentResearch?.stability.enabled,
    );

  const importanceEntries = useMemo(
    () =>
      Object.entries(
        research.analysis
          ?.parameter_importance ?? {},
      )
        .sort(([, left], [, right]) =>
          right - left,
        )
        .slice(0, 8),
    [research.analysis],
  );

  const robustWinner =
    research.research?.robustness
      ?.candidates[0];
  const robustness =
    research.research?.robustness;
  const stability =
    research.research?.stability;

  const left = research.experiments.find(
    (experiment) =>
      experiment.runId === leftRunId,
  );
  const right = research.experiments.find(
    (experiment) =>
      experiment.runId === rightRunId,
  );

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

  if (
    !canValidate &&
    importanceEntries.length === 0 &&
    research.experiments.length === 0
  ) {
    return null;
  }

  return (
    <section className="researchResults">
      <div className="rowLabel">
        <strong>Research</strong>
        {run.progress?.termination_reason ===
          'converged' && (
          <span className="researchBadge">
            converged early
          </span>
        )}
      </div>

      {importanceEntries.length > 0 && (
        <div className="researchBlock">
          <div className="researchBlockTitle">
            Parameter importance
          </div>
          <div className="importanceList">
            {importanceEntries.map(
              ([parameter, importance]) => (
                <div
                  className="importanceRow"
                  key={parameter}
                >
                  <div className="importanceMeta">
                    <span>
                      {inputLabel(parameter)}
                    </span>
                    <strong>
                      {Math.round(
                        importance * 100,
                      )}
                      %
                    </strong>
                  </div>
                  <div className="importanceTrack">
                    <div
                      className="importanceFill"
                      style={{
                        width:
                          Math.max(
                            2,
                            importance * 100,
                          ) + '%',
                      }}
                    />
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {canValidate && (
        <div className="researchBlock">
          <div className="rowLabel">
            <div>
              <div className="researchBlockTitle">
                Validation
              </div>
              {research.phase && (
                <div className="muted">
                  {research.phase}
                </div>
              )}
            </div>
            {!research.research && (
              <button
                className="secondary researchAction"
                disabled={research.busy}
                onClick={() =>
                  void research.runValidation()
                }
              >
                {research.busy
                  ? 'Running…'
                  : 'Run validation'}
              </button>
            )}
          </div>

          {robustness && robustWinner && (
            <div className="researchCard">
              <div className="rowLabel">
                <strong>Robust winner</strong>
                <span className="researchBadge good">
                  {robustWinner.passedWindows}/
                  {robustWinner.totalWindows}{' '}
                  folds
                </span>
              </div>

              <div className="researchSummaryGrid">
                <div>
                  <span>Optimisation</span>
                  <strong>
                    {formatMetric(
                      run.runConfig!
                        .objective_metric,
                      robustWinner
                        .optimisationObjective,
                    )}
                  </strong>
                </div>
                <div>
                  <span>OOS median</span>
                  <strong>
                    {robustWinner
                      .validationObjective ===
                    null
                      ? '—'
                      : formatMetric(
                          run.runConfig!
                            .objective_metric,
                          robustWinner
                            .validationObjective,
                        )}
                  </strong>
                </div>
                <div>
                  <span>Degradation</span>
                  <strong>
                    {robustWinner
                      .degradationPercent ===
                    null
                      ? '—'
                      : robustWinner
                          .degradationPercent
                          .toFixed(1) + '%'}
                  </strong>
                </div>
                <div>
                  <span>Trial</span>
                  <strong>
                    #
                    {robustWinner.trialNumber}
                  </strong>
                </div>
              </div>

              <button
                className="secondary researchApply"
                onClick={() =>
                  void research.applyRobustWinner()
                }
              >
                Apply robust winner
              </button>
            </div>
          )}

          {stability && (
            <div className="researchCard">
              <div className="rowLabel">
                <strong>
                  Parameter stability
                </strong>
                <span
                  className={
                    'researchBadge ' +
                    (stability.overallRating ===
                    'strong'
                      ? 'good'
                      : stability.overallRating ===
                          'moderate'
                        ? 'warn'
                        : 'bad')
                  }
                >
                  {stability.overallRating}
                </span>
              </div>

              <div className="stabilityList">
                {stability.parameters.map(
                  (parameter) => (
                    <div
                      className="stabilityRow"
                      key={
                        parameter.parameter
                      }
                    >
                      <span>
                        {inputLabel(
                          parameter.parameter,
                        )}
                      </span>
                      <span
                        className={
                          'researchBadge ' +
                          (parameter.rating ===
                          'strong'
                            ? 'good'
                            : parameter.rating ===
                                'moderate'
                              ? 'warn'
                              : 'bad')
                        }
                      >
                        {parameter.rating}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {research.experiments.length > 0 && (
        <details className="experimentHistory">
          <summary>
            Experiments (
            {research.experiments.length})
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
              {research.experiments.map(
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
              {research.experiments.map(
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
                <span>Trials</span>
                <code>
                  {left.completedTrials}
                </code>
                <code>
                  {right.completedTrials}
                </code>
              </div>

              <div className="comparisonRow">
                <span>Stopped by</span>
                <code>
                  {left.terminationReason ??
                    left.status}
                </code>
                <code>
                  {right.terminationReason ??
                    right.status}
                </code>
              </div>
            </div>
          )}

          {left && (
            <button
              className="textButton experimentDelete"
              onClick={() =>
                void research.removeExperiment(
                  left.runId,
                ).then(() =>
                  setLeftRunId(''),
                )
              }
            >
              Delete selected run
            </button>
          )}
        </details>
      )}
    </section>
  );
}
