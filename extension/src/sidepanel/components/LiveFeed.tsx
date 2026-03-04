import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useOptimizationStore } from '../store';
import type { OptimizationStatus, TrialResult } from '../../shared/types';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';
import { isActiveRunStatus } from '../utils/status';

type TrialRowProps = {
  trial: TrialResult;
  displayTrialNumber: number;
  isBest: boolean;
  isEven: boolean;
  source: 'current' | 'previous';
};

function getRowBackgroundClass(isBest: boolean, isEven: boolean): string {
  if (isBest) {
    return 'bg-accent-soft';
  }
  if (isEven) {
    return 'bg-bg-tertiary/20';
  }
  return '';
}

function getObjectiveValueClass(isBest: boolean, passedFilters: boolean): string {
  if (isBest) {
    return 'text-accent';
  }
  if (passedFilters) {
    return 'text-text-primary';
  }
  return 'text-text-muted';
}

function renderStatusIcon(isBest: boolean, passedFilters: boolean): ReactElement {
  if (isBest) {
    return (
      <span className="w-5 h-5 flex items-center justify-center text-accent">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </span>
    );
  }

  if (passedFilters) {
    return (
      <span className="w-5 h-5 flex items-center justify-center text-success">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  return (
    <span className="w-5 h-5 flex items-center justify-center text-danger">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}

function renderPauseResumeButton(
  status: OptimizationStatus,
  pauseOptimization: () => void,
  resumeOptimization: () => void,
): ReactElement | null {
  if (status === 'running') {
    return (
      <button
        onClick={pauseOptimization}
        className="ui-btn ui-btn-warning px-3 py-1.5 text-[11px]"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1.5" />
          <rect x="14" y="5" width="4" height="14" rx="1.5" />
        </svg>
        Pause
      </button>
    );
  }

  if (status === 'paused') {
    return (
      <button
        onClick={resumeOptimization}
        className="ui-btn ui-btn-success px-3 py-1.5 text-[11px]"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.8-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
        </svg>
        Resume
      </button>
    );
  }

  return null;
}

const TrialRow = memo(function TrialRow({
  trial,
  displayTrialNumber,
  isBest,
  isEven,
  source,
}: TrialRowProps): ReactElement {
  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 text-[12px] transition-colors ${
        getRowBackgroundClass(isBest, isEven)
      } ${!trial.passedFilters ? 'opacity-45' : ''}`}
    >
      {/* Trial number */}
      <span className="w-7 text-text-muted font-mono text-[11px] shrink-0">#{displayTrialNumber}</span>

      {source === 'previous' && (
        <span className="shrink-0 rounded-md border border-border/70 bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">
          Prev
        </span>
      )}

      {/* Status indicator */}
      <span className="shrink-0">{renderStatusIcon(isBest, trial.passedFilters)}</span>

      {/* Objective value */}
      <span className={`flex-1 font-mono font-medium ${getObjectiveValueClass(isBest, trial.passedFilters)}`}>
        {trial.objectiveValue.toFixed(4)}
      </span>

      {/* Duration */}
      <span className="text-text-muted font-mono text-[11px] shrink-0">{(trial.duration / 1000).toFixed(1)}s</span>

      {/* Filter failures tooltip */}
      {!trial.passedFilters && trial.filterFailures.length > 0 && (
        <span className="text-danger cursor-help shrink-0" title={trial.filterFailures.join('\n')}>
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
      )}
    </div>
  );
});

export default function LiveFeed() {
  const { trials, historyTrials, runMode, status, bestTrial, pauseOptimization, resumeOptimization, stopOptimization } =
    useOptimizationStore(
      useShallow((s) => ({
        trials: s.trials,
        historyTrials: s.historyTrials,
        runMode: s.runMode,
        status: s.status,
        bestTrial: s.bestTrial,
        pauseOptimization: s.pauseOptimization,
        resumeOptimization: s.resumeOptimization,
        stopOptimization: s.stopOptimization,
      })),
    );
  const [showPreviousRuns, setShowPreviousRuns] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const canShowHistory = runMode === 'warm_start' && historyTrials.length > 0;

  const visibleTrials = useMemo(() => {
    const rows: Array<{
      trial: TrialResult;
      displayTrialNumber: number;
      source: 'current' | 'previous';
      key: string;
    }> = [];
    if (canShowHistory && showPreviousRuns) {
      const orderedPrevious = [...historyTrials].sort((a, b) => a.timestamp - b.timestamp);
      rows.push(
        ...orderedPrevious.map((trial, index) => ({
          trial,
          displayTrialNumber: index,
          source: 'previous' as const,
          key: `prev-${trial.timestamp}-${trial.trialNumber}-${index}`,
        })),
      );
    }
    rows.push(
      ...trials.map((trial, index) => ({
        trial,
        displayTrialNumber: trial.trialNumber,
        source: 'current' as const,
        key: `cur-${trial.timestamp}-${trial.trialNumber}-${index}`,
      })),
    );
    // Newest trials first so the highest trial number stays at the top.
    rows.sort((a, b) => b.trial.timestamp - a.trial.timestamp);
    return rows;
  }, [canShowHistory, historyTrials, showPreviousRuns, trials]);

  useEffect(() => {
    if (feedRef.current) {
      // Keep viewport anchored to top for descending (newest-first) order.
      feedRef.current.scrollTop = 0;
    }
  }, [visibleTrials.length]);

  useEffect(() => {
    if (!canShowHistory && showPreviousRuns) {
      setShowPreviousRuns(false);
    }
  }, [canShowHistory, showPreviousRuns]);

  const { passedCount, failedCount } = useMemo(() => {
    const passed = visibleTrials.filter((row) => row.trial.passedFilters).length;
    return {
      passedCount: passed,
      failedCount: visibleTrials.length - passed,
    };
  }, [visibleTrials]);

  return (
    <div className="panel-card overflow-hidden">
      <PanelCardHeader
        title="Live Feed"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
            />
          </svg>
        }
        right={
          <div className="flex items-center gap-2">
            {canShowHistory && (
              <button
                onClick={() => setShowPreviousRuns((prev) => !prev)}
                className={`ui-btn px-2.5 py-1.5 text-[11px] ${
                  showPreviousRuns
                    ? 'ui-btn-secondary border-accent/45 bg-accent-soft text-accent'
                    : 'ui-btn-ghost'
                }`}
              >
                {showPreviousRuns ? 'Hide Previous Trials' : 'Show Previous Trials'}
              </button>
            )}
            {renderPauseResumeButton(status, pauseOptimization, resumeOptimization)}
            {isActiveRunStatus(status) && (
              <button
                onClick={stopOptimization}
                className="ui-btn ui-btn-danger px-3 py-1.5 text-[11px]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            )}
          </div>
        }
      />

      {/* Stats bar */}
      <div className="flex items-center gap-4 border-b border-border/35 bg-bg-tertiary/32 px-4 py-3 text-[11px]">
        <span className="text-text-muted">
          Total: <span className="text-text-secondary font-mono font-medium">{visibleTrials.length}</span>
        </span>
        <span className="text-text-muted">
          Passed: <span className="text-success font-mono font-medium">{passedCount}</span>
        </span>
        <span className="text-text-muted">
          Failed: <span className="text-danger font-mono font-medium">{failedCount}</span>
        </span>
        {bestTrial && (
          <span className="text-text-muted ml-auto">
            Best: <span className="text-accent font-mono font-medium">{bestTrial.objectiveValue.toFixed(4)}</span>
          </span>
        )}
      </div>

      {/* Trial list */}
      <div ref={feedRef} className="max-h-72 overflow-y-auto">
        {visibleTrials.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted text-[12px]">
            {status === 'running' ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span>Waiting for first trial...</span>
              </div>
            ) : (
              'No trials yet'
            )}
          </div>
        ) : (
          visibleTrials.map((row, index) => (
            <TrialRow
              key={row.key}
              trial={row.trial}
              displayTrialNumber={row.displayTrialNumber}
              source={row.source}
              isBest={
                row.source === 'current' &&
                bestTrial?.trialNumber === row.trial.trialNumber &&
                bestTrial?.timestamp === row.trial.timestamp
              }
              isEven={index % 2 === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
