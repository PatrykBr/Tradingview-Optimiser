import { useMemo, useState } from 'react';

import { formatMetric } from '../../lib/optimisation/metrics';
import {
  buildResearchVerdict,
} from '../../lib/optimisation/research-verdict';
import type { ExperimentRecord } from '../../lib/optimisation/storage';
import type { CreateRun } from '../../lib/protocol/types';
import type { ResearchValidationModel } from './useResearchValidation';
import type { OptimisationRunModel } from './useOptimisationRun';

interface ResearchSectionProps {
  run: OptimisationRunModel;
  research: ResearchValidationModel;
  inputLabel: (id: string) => string;
  onLoadExperiment: (
    config: CreateRun,
  ) => Promise<void>;
  onRerunExperiment: (
    config: CreateRun,
  ) => Promise<void>;
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

const formatMonteCarloValue = (
  value: number,
  unit: 'percent' | 'pnl',
): string =>
  unit === 'percent'
    ? value.toFixed(2) + '%'
    : value.toFixed(2);

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

export default function ResearchSection({
  run,
  research,
  inputLabel,
  onLoadExperiment,
  onRerunExperiment,
}: ResearchSectionProps) {
  const [leftRunId, setLeftRunId] =
    useState('');
  const [rightRunId, setRightRunId] =
    useState('');

  const currentResearch =
    run.runConfig?.research;
  const objectiveMetric =
    run.runConfig?.objective_metric ??
    'profitFactor';
  const canValidate =
    terminal(run.progress?.status) &&
    Boolean(run.progress?.best) &&
    Boolean(
      currentResearch?.robustness.enabled ||
        currentResearch?.stability.enabled ||
        currentResearch?.walk_forward?.enabled ||
        currentResearch?.monte_carlo?.enabled,
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
  const walkForward =
    research.research?.walkForward;
  const monteCarlo =
    research.research?.monteCarlo;

  const verdict = useMemo(
    () =>
      run.runConfig &&
      run.progress &&
      research.research
        ? buildResearchVerdict(
            run.runConfig,
            run.progress,
            research.research,
          )
        : null,
    [
      research.research,
      run.progress,
      run.runConfig,
    ],
  );

  const left = research.experiments.find(
    (experiment) =>
      experiment.runId === leftRunId,
  );
  const right = research.experiments.find(
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
          <div className="muted researchImportanceHint">
            Conditional parameters appear when they were sampled consistently.
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
            <button
              className={
                research.busy
                  ? 'danger researchAction'
                  : 'secondary researchAction'
              }
              onClick={() =>
                research.busy
                  ? research.cancelValidation()
                  : void research.runValidation()
              }
            >
              {research.busy
                ? 'Cancel'
                : research.research
                  ? 'Re-run'
                  : 'Run validation'}
            </button>
          </div>

          {verdict && (
            <div className="researchCard evidenceCard">
              <div className="rowLabel">
                <strong>
                  Research evidence
                </strong>
                <span
                  className={
                    'researchBadge ' +
                    (verdict.overall ===
                    'strong'
                      ? 'good'
                      : verdict.overall ===
                          'weak'
                        ? 'bad'
                        : 'warn')
                  }
                >
                  {verdict.overall}
                </span>
              </div>

              <div className="evidenceList">
                {verdict.areas.map(
                  (area) => (
                    <div
                      className="evidenceRow"
                      key={area.id}
                      title={area.detail}
                    >
                      <span>{area.label}</span>
                      <span
                        className={
                          'researchBadge ' +
                          (area.rating ===
                          'strong'
                            ? 'good'
                            : area.rating ===
                                'weak'
                              ? 'bad'
                              : area.rating ===
                                  'moderate'
                                ? 'warn'
                                : '')
                        }
                      >
                        {area.rating}
                      </span>
                    </div>
                  ),
                )}
              </div>

              {verdict.concerns.length > 0 && (
                <div className="evidenceConcern">
                  Main concern:{' '}
                  {verdict.concerns[0]}
                </div>
              )}
            </div>
          )}

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
                      objectiveMetric,
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
                          objectiveMetric,
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

          {walkForward && (
            <div className="researchCard">
              <div className="rowLabel">
                <strong>
                  Walk-forward
                </strong>
                <span
                  className={
                    'researchBadge ' +
                    (walkForward.passedFolds /
                        Math.max(
                          1,
                          walkForward.totalFolds,
                        ) >=
                      0.75
                      ? 'good'
                      : walkForward.passedFolds /
                            Math.max(
                              1,
                              walkForward.totalFolds,
                            ) >=
                          0.5
                        ? 'warn'
                        : 'bad')
                  }
                >
                  {walkForward.passedFolds}/
                  {walkForward.totalFolds}{' '}
                  folds
                </span>
              </div>

              <div className="researchSummaryGrid">
                <div>
                  <span>Median OOS</span>
                  <strong>
                    {walkForward
                      .medianTestObjective ===
                    null
                      ? '—'
                      : formatMetric(
                          objectiveMetric,
                          walkForward
                            .medianTestObjective,
                        )}
                  </strong>
                </div>
                <div>
                  <span>Worst OOS</span>
                  <strong>
                    {walkForward
                      .worstTestObjective ===
                    null
                      ? '—'
                      : formatMetric(
                          objectiveMetric,
                          walkForward
                            .worstTestObjective,
                        )}
                  </strong>
                </div>
              </div>

              <div className="stabilityList">
                {Object.entries(
                  walkForward
                    .parameterConsistency,
                )
                  .filter(
                    ([, rating]) =>
                      rating !==
                      'insufficient',
                  )
                  .slice(0, 8)
                  .map(
                    ([parameter, rating]) => (
                      <div
                        className="stabilityRow"
                        key={parameter}
                      >
                        <span>
                          {inputLabel(
                            parameter,
                          )}
                        </span>
                        <span
                          className={
                            'researchBadge ' +
                            (rating === 'stable'
                              ? 'good'
                              : 'warn')
                          }
                        >
                          {rating}
                        </span>
                      </div>
                    ),
                  )}
              </div>
            </div>
          )}

          {monteCarlo && (
            <div className="researchCard">
              <div className="rowLabel">
                <strong>
                  Monte Carlo
                </strong>
                <span
                  className={
                    'researchBadge ' +
                    (monteCarlo.available
                      ? 'good'
                      : 'warn')
                  }
                >
                  {monteCarlo.available
                    ? monteCarlo.sampleSize +
                      ' trades'
                    : 'unavailable'}
                </span>
              </div>

              {!monteCarlo.available ? (
                <p className="helpText">
                  {monteCarlo.reason}
                </p>
              ) : (
                <>
                  <div className="researchSummaryGrid">
                    <div>
                      <span>
                        Loss probability
                      </span>
                      <strong>
                        {monteCarlo
                          .probabilityOfLoss ===
                        null
                          ? '—'
                          : (
                              monteCarlo
                                .probabilityOfLoss *
                              100
                            ).toFixed(1) +
                            '%'}
                      </strong>
                    </div>
                    <div>
                      <span>
                        Median max DD
                      </span>
                      <strong>
                        {monteCarlo
                          .maxDrawdown
                          ? formatMonteCarloValue(
                              monteCarlo
                                .maxDrawdown
                                .median,
                              monteCarlo.unit,
                            )
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>
                        95% max DD
                      </span>
                      <strong>
                        {monteCarlo
                          .maxDrawdown
                          ? formatMonteCarloValue(
                              monteCarlo
                                .maxDrawdown
                                .p95,
                              monteCarlo.unit,
                            )
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>
                        PF median
                      </span>
                      <strong>
                        {monteCarlo
                          .profitFactor
                          ? monteCarlo
                              .profitFactor
                              .median.toFixed(
                                2,
                              )
                          : '—'}
                      </strong>
                    </div>
                  </div>

                  {monteCarlo.total && (
                    <div className="confidenceLine">
                      {Math.round(
                        monteCarlo.confidence *
                          100,
                      )}
                      % cumulative PnL interval:{' '}
                      <strong>
                        {formatMonteCarloValue(
                          monteCarlo.total.low,
                          monteCarlo.unit,
                        )}
                        {' – '}
                        {formatMonteCarloValue(
                          monteCarlo.total.high,
                          monteCarlo.unit,
                        )}
                      </strong>
                      {' · '}
                      {monteCarlo.source ===
                      'oos'
                        ? 'unseen OOS sample'
                        : 'optimisation sample'}
                    </div>
                  )}
                </>
              )}
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
            <div className="experimentActions">
              <button
                className="secondary"
                disabled={research.busy}
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
                  research.busy ||
                  !run.connected ||
                  run.activeRunId !== null
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
                disabled={research.busy}
                onClick={() =>
                  void research.removeExperiment(
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
      )}
    </section>
  );
}
