import { useMemo, useState } from 'react';

import BestSoFarChart from '../BestSoFarChart';
import {
  formatMetric,
  metricDefinition,
} from '../../lib/optimisation/metrics';
import {
  bestSoFar,
  estimateRemainingMs,
  filterTrials,
  isFeasibleTrial,
  sortTrials,
  type TrialFilter,
  type TrialSort,
} from '../../lib/optimisation/results';
import type { TrialSummary } from '../../lib/protocol/types';
import type { OptimisationRunModel } from './useOptimisationRun';

interface RunProgressSectionProps {
  run: OptimisationRunModel;
  inputLabel: (id: string) => string;
  fallbackTargetTrials: string;
  busy: boolean;
}

const parseTrialFilter = (
  value: string,
): TrialFilter => {
  switch (value) {
    case 'all':
    case 'valid':
    case 'filtered':
    case 'failed':
      return value;
    default:
      return 'all';
  }
};

const parseTrialSort = (
  value: string,
): TrialSort => {
  switch (value) {
    case 'trial-desc':
    case 'trial-asc':
    case 'objective-best':
    case 'objective-worst':
    case 'duration':
      return value;
    default:
      return 'trial-desc';
  }
};

const formatDuration = (
  milliseconds: number | null,
): string => {
  if (
    milliseconds === null ||
    !Number.isFinite(milliseconds)
  ) {
    return '—';
  }

  const seconds = Math.max(
    0,
    Math.round(milliseconds / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60,
  );
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return hours + 'h ' + minutes + 'm';
  }
  if (minutes > 0) {
    return (
      minutes +
      'm ' +
      remainingSeconds +
      's'
    );
  }
  return remainingSeconds + 's';
};

export default function RunProgressSection({
  run,
  inputLabel,
  fallbackTargetTrials,
  busy,
}: RunProgressSectionProps) {
  const [trialFilter, setTrialFilter] =
    useState<TrialFilter>('all');
  const [trialSort, setTrialSort] =
    useState<TrialSort>('trial-desc');
  const [
    selectedTrialNumber,
    setSelectedTrialNumber,
  ] = useState<number | null>(null);

  const objective = metricDefinition(
    run.runConfig?.objective_metric ??
      'profitFactor',
  );
  const best = run.progress?.best ?? null;

  const completion =
    run.progress?.status === 'completed'
      ? 100
      : run.progress &&
          run.progress.target_trials > 0
        ? Math.min(
            100,
            (run.progress.completed_trials /
              run.progress.target_trials) *
              100,
          )
        : 0;

  const selectedTrial: TrialSummary | null =
    selectedTrialNumber === null
      ? null
      : run.progress?.trials.find(
          (trial) =>
            trial.trial_number ===
            selectedTrialNumber,
        ) ?? null;

  const displayedTrials = useMemo(
    () =>
      run.progress
        ? sortTrials(
            filterTrials(
              run.progress.trials,
              trialFilter,
            ),
            trialSort,
            run.runConfig?.direction ??
              'maximize',
          )
        : [],
    [
      run.progress,
      run.runConfig?.direction,
      trialFilter,
      trialSort,
    ],
  );

  const graphPoints = useMemo(
    () =>
      run.progress
        ? bestSoFar(
            run.progress.trials,
            run.runConfig?.direction ??
              'maximize',
          )
        : [],
    [
      run.progress,
      run.runConfig?.direction,
    ],
  );

  const eta = useMemo(
    () =>
      run.progress &&
      run.progress.status === 'running'
        ? estimateRemainingMs(
            run.progress.trials,
            run.progress.completed_trials,
            run.progress.target_trials,
          )
        : null,
    [run.progress],
  );

  if (
    !run.progress &&
    !run.currentTrial &&
    !run.stopChoiceVisible
  ) {
    return null;
  }

  return (
    <>
      {(run.progress || run.currentTrial) && (
        <section>
          <div className="rowLabel">
            <strong>Progress</strong>
            <span className="muted">
              {run.progress?.completed_trials ??
                0}
              /
              {run.progress?.target_trials ??
                fallbackTargetTrials}
            </span>
          </div>

          <div className="progressTrack">
            <div
              className="progressFill"
              style={{
                width: completion + '%',
              }}
            />
          </div>

          <div className="runTiming">
            <span>
              Elapsed{' '}
              {formatDuration(run.elapsedMs)}
            </span>
            <span>
              ETA {formatDuration(eta)}
            </span>
          </div>

          {run.currentTrial && (
            <div className="currentTrial">
              Trial #{run.currentTrial.number} ·{' '}
              {run.currentTrial.phase ===
              'checking'
                ? 'checking chart'
                : run.currentTrial.phase ===
                    'recalculating'
                  ? 'running TradingView backtest'
                  : 'submitting result'}
            </div>
          )}

          {graphPoints.length >= 2 && (
            <BestSoFarChart
              points={graphPoints}
              metricKey={objective.key}
            />
          )}

          {best && (
            <div className="bestCard">
              <div className="rowLabel">
                <strong>
                  Best feasible result
                </strong>
                <span className="bestValue">
                  {objective.label}{' '}
                  {formatMetric(
                    objective.key,
                    best
                      .objective_value,
                  )}
                </span>
              </div>

              <div className="compactMetrics">
                {[
                  'profitFactor',
                  'netProfitPercent',
                  'maxDrawdownPercent',
                  'totalTrades',
                  'sharpeRatio',
                  'sortinoRatio',
                ].flatMap((key) => {
                  const value =
                    best
                      ?.metrics[key];

                  if (
                    typeof value !== 'number' ||
                    !Number.isFinite(value)
                  ) {
                    return [];
                  }

                  return [
                    <div key={key}>
                      <span>
                        {
                          metricDefinition(key)
                            .label
                        }
                      </span>
                      <strong>
                        {formatMetric(
                          key,
                          value,
                        )}
                      </strong>
                    </div>,
                  ];
                })}
              </div>

              <div className="bestParameters">
                {Object.entries(
                  best.parameters,
                ).map(([id, value]) => (
                  <div key={id}>
                    <span>
                      {inputLabel(id)}
                    </span>
                    <code>
                      {String(value)}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {run.progress &&
            run.progress.trials.length > 0 && (
              <>
                <div className="trialToolbar">
                  <select
                    value={trialFilter}
                    onChange={(event) =>
                      setTrialFilter(
                        parseTrialFilter(
                          event.target.value,
                        ),
                      )
                    }
                  >
                    <option value="all">
                      All trials
                    </option>
                    <option value="valid">
                      Valid
                    </option>
                    <option value="filtered">
                      Filtered
                    </option>
                    <option value="failed">
                      Failed
                    </option>
                  </select>

                  <select
                    value={trialSort}
                    onChange={(event) =>
                      setTrialSort(
                        parseTrialSort(
                          event.target.value,
                        ),
                      )
                    }
                  >
                    <option value="trial-desc">
                      Newest
                    </option>
                    <option value="trial-asc">
                      Oldest
                    </option>
                    <option value="objective-best">
                      Best objective
                    </option>
                    <option value="objective-worst">
                      Worst objective
                    </option>
                    <option value="duration">
                      Slowest
                    </option>
                  </select>
                </div>

                <div className="trialList">
                  {displayedTrials.map(
                    (trial) => {
                      const feasible =
                        isFeasibleTrial(trial);

                      return (
                        <button
                          className={
                            'trialRow trialButton' +
                            (selectedTrialNumber ===
                            trial.trial_number
                              ? ' selectedTrial'
                              : '')
                          }
                          key={
                            trial.trial_number
                          }
                          onClick={() =>
                            setSelectedTrialNumber(
                              trial.trial_number,
                            )
                          }
                        >
                          <span>
                            #
                            {
                              trial.trial_number
                            }
                          </span>
                          <strong>
                            {trial.objective_value ===
                            null
                              ? 'Failed'
                              : formatMetric(
                                  objective.key,
                                  trial.objective_value,
                                )}
                          </strong>
                          <span
                            className={
                              trial.state ===
                              'failed'
                                ? 'trialState failed'
                                : feasible
                                  ? 'trialState feasible'
                                  : 'trialState constrained'
                            }
                          >
                            {trial.state ===
                            'failed'
                              ? 'failed'
                              : feasible
                                ? 'valid'
                                : 'filtered'}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </>
            )}

          {selectedTrial && (
            <div className="trialDetail">
              <div className="rowLabel">
                <strong>
                  Trial #
                  {
                    selectedTrial.trial_number
                  }
                </strong>
                <button
                  className="textButton"
                  onClick={() =>
                    setSelectedTrialNumber(
                      null,
                    )
                  }
                >
                  Close
                </button>
              </div>

              {selectedTrial.failure_reason && (
                <div className="detailError">
                  {
                    selectedTrial.failure_reason
                  }
                </div>
              )}

              <h3>Parameters</h3>
              <div className="metricsList">
                {Object.entries(
                  selectedTrial.parameters,
                ).map(([key, value]) => (
                  <div key={key}>
                    <span>
                      {inputLabel(key)}
                    </span>
                    <code>
                      {String(value)}
                    </code>
                  </div>
                ))}
              </div>

              <h3>Constraints</h3>
              <div className="metricsList">
                {Object.entries(
                  selectedTrial.constraints,
                ).length === 0 ? (
                  <div>
                    <span>
                      No constraints
                    </span>
                    <code>—</code>
                  </div>
                ) : (
                  Object.entries(
                    selectedTrial.constraints,
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>
                        {value <= 0
                          ? 'pass'
                          : 'fail (' +
                            value.toFixed(
                              4,
                            ) +
                            ')'}
                      </code>
                    </div>
                  ))
                )}
              </div>

              <h3>
                Full TradingView metrics
              </h3>
              <div className="metricsList fullMetrics">
                {Object.entries(
                  selectedTrial.metrics,
                )
                  .sort(([a], [b]) =>
                    a.localeCompare(b),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>
                        {formatMetric(
                          key,
                          value,
                        )}
                      </code>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {run.progress &&
            run.runConfig && (
              <div className="exportRow">
                <button
                  className="secondary"
                  onClick={() =>
                    void run.exportRun(
                      'csv',
                    )
                  }
                >
                  Export CSV
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    void run.exportRun(
                      'json',
                    )
                  }
                >
                  Export JSON
                </button>
              </div>
            )}
        </section>
      )}

      {run.stopChoiceVisible && (
        <section className="stopChoice">
          <strong>
            Optimisation stopped
          </strong>
          <p className="helpText">
            Choose which parameters TradingView
            should keep.
          </p>
          <div className="stackedButtons">
            <button
              className="primary"
              disabled={
                !run.progress?.best || busy
              }
              onClick={() =>
                void run.applyBestParameters()
              }
            >
              Apply best parameters
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run.restoreOriginalParameters()
              }
            >
              Restore original parameters
            </button>
            <button
              className="textButton"
              onClick={
                run.dismissStopChoice
              }
            >
              Keep current parameters
            </button>
          </div>
        </section>
      )}

      {run.progress?.best &&
        run.activeRunId === null &&
        !run.stopChoiceVisible && (
          <section>
            <div className="buttonRow twoButtons">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run.applyBestParameters()
                }
              >
                Apply best
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run.restoreOriginalParameters()
                }
              >
                Restore original
              </button>
            </div>
          </section>
        )}
    </>
  );
}
