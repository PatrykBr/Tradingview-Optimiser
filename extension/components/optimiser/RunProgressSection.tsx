import { useEffect, useMemo, useRef, useState } from 'react';

import BestSoFarChart from '../BestSoFarChart';
import { formatMetric, metricDefinition } from '../../lib/optimisation/metrics';
import {
  bestSoFar,
  estimateRemainingMs,
  extendBestSoFar,
  filterTrials,
  isFeasibleTrial,
  sortTrials,
  type BestSoFarPoint,
  type TrialFilter,
  type TrialSort,
} from '../../lib/optimisation/results';
import type { ObjectiveDirection, TrialSummary } from '../../lib/protocol/types';
import type { OptimisationRunModel } from './useOptimisationRun';

const TRIALS_PER_PAGE = 100;

interface RunProgressSectionProps {
  run: OptimisationRunModel;
  inputLabel: (id: string) => string;
  fallbackTargetTrials: string;
  busy: boolean;
}

const parseTrialFilter = (value: string): TrialFilter => {
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

const parseTrialSort = (value: string): TrialSort => {
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

const terminationLabel = (
  reason: 'target_trials' | 'converged' | 'search_space_exhausted' | 'user' | null | undefined,
): string | null => {
  switch (reason) {
    case 'target_trials':
      return 'target reached';
    case 'converged':
      return 'converged';
    case 'search_space_exhausted':
      return 'search space exhausted';
    case 'user':
      return 'stopped by user';
    default:
      return null;
  }
};

const formatDuration = (milliseconds: number | null): string => {
  if (milliseconds === null || !Number.isFinite(milliseconds)) {
    return 'Unavailable';
  }

  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return hours + 'h ' + minutes + 'm';
  }
  if (minutes > 0) {
    return minutes + 'm ' + remainingSeconds + 's';
  }
  return remainingSeconds + 's';
};

const formatPhaseDuration = (milliseconds: number): string =>
  milliseconds < 1_000 ? Math.round(milliseconds) + 'ms' : formatDuration(milliseconds);

export default function RunProgressSection({
  run,
  inputLabel,
  fallbackTargetTrials,
  busy,
}: RunProgressSectionProps) {
  const [trialFilter, setTrialFilter] = useState<TrialFilter>('all');
  const [trialSort, setTrialSort] = useState<TrialSort>('trial-desc');
  const [selectedTrialNumber, setSelectedTrialNumber] = useState<number | null>(null);
  const [trialPage, setTrialPage] = useState(0);
  const graphCacheRef = useRef<{
    runId: string | null;
    direction: ObjectiveDirection;
    processedTrials: number;
    lastTrialNumber: number | null;
    points: BestSoFarPoint[];
  }>({
    runId: null,
    direction: 'maximize',
    processedTrials: 0,
    lastTrialNumber: null,
    points: [],
  });

  const objective = metricDefinition(run.runConfig?.objective_metric ?? 'profitFactor');
  const direction: ObjectiveDirection = run.runConfig?.direction ?? 'maximize';
  const best = run.progress?.best ?? null;
  const reusedTrials = run.progress?.reused_trials ?? 0;
  const completionReason = terminationLabel(run.progress?.termination_reason);

  const completion =
    run.progress?.status === 'completed'
      ? 100
      : run.progress && run.progress.target_trials > 0
        ? Math.min(100, (run.progress.completed_trials / run.progress.target_trials) * 100)
        : 0;

  const selectedTrial: TrialSummary | null =
    selectedTrialNumber === null
      ? null
      : (run.progress?.trials.find((trial) => trial.trial_number === selectedTrialNumber) ?? null);

  const newestFastPath = trialFilter === 'all' && trialSort === 'trial-desc';

  const displayedTrials = useMemo(
    () =>
      run.progress && !newestFastPath
        ? sortTrials(filterTrials(run.progress.trials, trialFilter), trialSort, direction)
        : [],
    [run.progress, direction, newestFastPath, trialFilter, trialSort],
  );

  const displayedTrialCount = newestFastPath
    ? (run.progress?.trials.length ?? 0)
    : displayedTrials.length;

  const totalTrialPages = Math.max(1, Math.ceil(displayedTrialCount / TRIALS_PER_PAGE));
  const visibleTrialPage = Math.min(trialPage, totalTrialPages - 1);

  const visibleTrials = useMemo(() => {
    if (newestFastPath && run.progress) {
      const trials = run.progress.trials;
      const end = Math.max(0, trials.length - visibleTrialPage * TRIALS_PER_PAGE);
      const start = Math.max(0, end - TRIALS_PER_PAGE);

      // Slice the visible page for the newest/all view without copying and
      // reversing the entire history after each trial.
      return trials.slice(start, end).reverse();
    }

    return displayedTrials.slice(
      visibleTrialPage * TRIALS_PER_PAGE,
      (visibleTrialPage + 1) * TRIALS_PER_PAGE,
    );
  }, [displayedTrials, newestFastPath, run.progress, visibleTrialPage]);

  useEffect(() => {
    setTrialPage(0);
  }, [trialFilter, trialSort]);

  useEffect(() => {
    if (trialPage !== visibleTrialPage) {
      setTrialPage(visibleTrialPage);
    }
  }, [trialPage, visibleTrialPage]);

  const graphPoints = useMemo(() => {
    const current = run.progress;
    const cache = graphCacheRef.current;

    if (!current) {
      graphCacheRef.current = {
        runId: null,
        direction,
        processedTrials: 0,
        lastTrialNumber: null,
        points: [],
      };
      return [];
    }

    const cachedBoundary =
      cache.processedTrials > 0
        ? (current.trials[cache.processedTrials - 1]?.trial_number ?? null)
        : null;
    const canExtend =
      cache.runId === current.run_id &&
      cache.direction === direction &&
      cache.processedTrials <= current.trials.length &&
      cache.lastTrialNumber === cachedBoundary;

    const points = canExtend
      ? extendBestSoFar(cache.points, current.trials.slice(cache.processedTrials), direction)
      : bestSoFar(current.trials, direction);

    graphCacheRef.current = {
      runId: current.run_id,
      direction,
      processedTrials: current.trials.length,
      lastTrialNumber: current.trials.at(-1)?.trial_number ?? null,
      points,
    };

    return points;
  }, [direction, run.progress]);

  const eta = useMemo(
    () =>
      run.progress && run.progress.status === 'running'
        ? estimateRemainingMs(
            run.progress.trials,
            run.progress.completed_trials,
            run.progress.target_trials,
          )
        : null,
    [run.progress],
  );

  const phaseTimings = useMemo(() => {
    const trials = run.progress?.trials;
    if (!trials) return null;

    let samples = 0;
    let evaluationMs = 0;
    let contextMs = 0;

    for (let index = trials.length - 1; index >= 0 && samples < 20; index -= 1) {
      const metrics = trials[index]?.metrics;
      if (!metrics) continue;

      const evaluation = metrics['tvopt.evaluationMs'];
      const contextPre = metrics['tvopt.contextPreMs'];
      const contextPost = metrics['tvopt.contextPostMs'];

      if (
        typeof evaluation !== 'number' ||
        !Number.isFinite(evaluation) ||
        typeof contextPre !== 'number' ||
        !Number.isFinite(contextPre) ||
        typeof contextPost !== 'number' ||
        !Number.isFinite(contextPost)
      ) {
        continue;
      }

      evaluationMs += evaluation;
      contextMs += contextPre + contextPost;
      samples += 1;
    }

    return samples > 0
      ? {
          evaluationMs: evaluationMs / samples,
          contextMs: contextMs / samples,
        }
      : null;
  }, [run.progress]);

  if (!run.progress && !run.currentTrial && !run.stopChoiceVisible) {
    return null;
  }

  return (
    <>
      {(run.progress || run.currentTrial) && (
        <section>
          <div className="rowLabel">
            <strong>Progress</strong>
            <span className="muted">
              {run.progress?.completed_trials ?? 0}/
              {run.progress?.target_trials ?? fallbackTargetTrials}
              {reusedTrials > 0 && ' · ' + reusedTrials + ' reused'}
              {run.progress?.status === 'completed' && completionReason && ' · ' + completionReason}
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
            <span>Elapsed {formatDuration(run.elapsedMs)}</span>
            <span>Time remaining {formatDuration(eta)}</span>
          </div>

          {phaseTimings && (
            <div className="runTiming">
              <span>Average backtest {formatPhaseDuration(phaseTimings.evaluationMs)}</span>
              <span>safety {formatPhaseDuration(phaseTimings.contextMs)}</span>
            </div>
          )}

          {run.currentTrial && (
            <div className="currentTrial">
              Trial #{run.currentTrial.number} ·{' '}
              {run.currentTrial.phase === 'checking'
                ? 'checking chart'
                : run.currentTrial.phase === 'recalculating'
                  ? 'running TradingView backtest'
                  : 'submitting result'}
            </div>
          )}

          {graphPoints.length >= 2 && (
            <BestSoFarChart points={graphPoints} metricKey={objective.key} />
          )}

          {best && (
            <div className="bestCard">
              <div className="rowLabel">
                <strong>Best feasible result</strong>
                <span className="bestValue">
                  {objective.label} {formatMetric(objective.key, best.objective_value)}
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
                  const value = best.metrics[key];

                  if (typeof value !== 'number' || !Number.isFinite(value)) {
                    return [];
                  }

                  return [
                    <div key={key}>
                      <span>{metricDefinition(key).label}</span>
                      <strong>{formatMetric(key, value)}</strong>
                    </div>,
                  ];
                })}
              </div>

              <div className="bestParameters">
                {Object.entries(best.parameters).map(([id, value]) => (
                  <div key={id}>
                    <span>{inputLabel(id)}</span>
                    <code>{String(value)}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {run.progress && run.progress.trials.length > 0 && (
            <>
              <div className="trialToolbar">
                <select
                  aria-label="Filter trials"
                  value={trialFilter}
                  onChange={(event) => setTrialFilter(parseTrialFilter(event.target.value))}
                >
                  <option value="all">All trials</option>
                  <option value="valid">Valid</option>
                  <option value="filtered">Filtered</option>
                  <option value="failed">Failed</option>
                </select>

                <select
                  aria-label="Sort trials"
                  value={trialSort}
                  onChange={(event) => setTrialSort(parseTrialSort(event.target.value))}
                >
                  <option value="trial-desc">Newest</option>
                  <option value="trial-asc">Oldest</option>
                  <option value="objective-best">Best objective</option>
                  <option value="objective-worst">Worst objective</option>
                  <option value="duration">Slowest</option>
                </select>
              </div>

              <div className="trialList">
                {visibleTrials.map((trial) => {
                  const feasible = isFeasibleTrial(trial);

                  return (
                    <button
                      className={
                        'trialRow trialButton' +
                        (selectedTrialNumber === trial.trial_number ? ' selectedTrial' : '')
                      }
                      key={trial.trial_number}
                      onClick={() => setSelectedTrialNumber(trial.trial_number)}
                    >
                      <span>#{trial.trial_number}</span>
                      <strong>
                        {trial.objective_value === null
                          ? 'Failed'
                          : formatMetric(objective.key, trial.objective_value)}
                      </strong>
                      <span
                        className={
                          trial.state === 'failed'
                            ? 'trialState failed'
                            : feasible
                              ? 'trialState feasible'
                              : 'trialState constrained'
                        }
                      >
                        {trial.state === 'failed' ? 'failed' : feasible ? 'valid' : 'filtered'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {totalTrialPages > 1 && (
                <div className="trialPagination">
                  <button
                    className="textButton"
                    disabled={visibleTrialPage === 0}
                    onClick={() => setTrialPage((page) => Math.max(0, page - 1))}
                  >
                    Previous
                  </button>
                  <span className="muted">
                    Page {visibleTrialPage + 1}/{totalTrialPages}
                    {' · '}
                    {displayedTrialCount} trials
                  </span>
                  <button
                    className="textButton"
                    disabled={visibleTrialPage >= totalTrialPages - 1}
                    onClick={() => setTrialPage((page) => Math.min(totalTrialPages - 1, page + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {selectedTrial && (
            <div className="trialDetail">
              <div className="rowLabel">
                <strong>Trial #{selectedTrial.trial_number}</strong>
                <button className="textButton" onClick={() => setSelectedTrialNumber(null)}>
                  Close
                </button>
              </div>

              {selectedTrial.failure_reason && (
                <div className="detailError">{selectedTrial.failure_reason}</div>
              )}

              {selectedTrial.reused_from_trial !== undefined &&
                selectedTrial.reused_from_trial !== null && (
                  <div className="muted">
                    Result reused from trial #{selectedTrial.reused_from_trial}. No duplicate
                    TradingView backtest was run.
                  </div>
                )}

              <h3>Parameters</h3>
              <div className="metricsList">
                {Object.entries(selectedTrial.parameters).map(([key, value]) => (
                  <div key={key}>
                    <span>{inputLabel(key)}</span>
                    <code>{String(value)}</code>
                  </div>
                ))}
              </div>

              <h3>Constraints</h3>
              <div className="metricsList">
                {Object.entries(selectedTrial.constraints).length === 0 ? (
                  <div>
                    <span>No constraints</span>
                    <code>None</code>
                  </div>
                ) : (
                  Object.entries(selectedTrial.constraints).map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>{value <= 0 ? 'pass' : 'fail (' + value.toFixed(4) + ')'}</code>
                    </div>
                  ))
                )}
              </div>

              <h3>Full TradingView metrics</h3>
              <div className="metricsList fullMetrics">
                {Object.entries(selectedTrial.metrics)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>{formatMetric(key, value)}</code>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {run.progress && run.runConfig && (
            <div className="exportRow">
              <button className="secondary" onClick={() => void run.exportRun('csv')}>
                Export CSV
              </button>
              <button className="secondary" onClick={() => void run.exportRun('json')}>
                Export JSON
              </button>
            </div>
          )}
        </section>
      )}

      {run.stopChoiceVisible && (
        <section className="stopChoice">
          <strong>Optimisation stopped</strong>
          <p className="helpText">Choose which parameters TradingView should keep.</p>
          <div className="stackedButtons">
            <button
              className="primary"
              disabled={!run.progress?.best || busy}
              onClick={() => void run.applyBestParameters()}
            >
              Apply best parameters
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run.restoreOriginalParameters()}
            >
              Restore original parameters
            </button>
            <button className="textButton" onClick={run.dismissStopChoice}>
              Keep current parameters
            </button>
          </div>
        </section>
      )}

      {run.progress?.best && run.activeRunId === null && !run.stopChoiceVisible && (
        <section>
          <div className="buttonRow twoButtons">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run.applyBestParameters()}
            >
              Apply best
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run.restoreOriginalParameters()}
            >
              Restore original
            </button>
          </div>
        </section>
      )}
    </>
  );
}
