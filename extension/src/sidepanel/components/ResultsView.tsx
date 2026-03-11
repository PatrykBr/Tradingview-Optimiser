import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useOptimizationStore } from '../store';
import type { TrialResult } from '../../shared/types';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';

type SortKey = 'trialNumber' | 'objectiveValue' | 'duration';
type SortDir = 'asc' | 'desc';
type SortColumn = { key: SortKey; label: string; className: string };
type ApplyParamsStatus = 'idle' | 'applying' | 'success' | 'error';
type SortIconProps = { active: boolean; dir: SortDir };

const SORT_COLUMNS: SortColumn[] = [
  { key: 'trialNumber', label: '#', className: 'w-12 text-left hover:text-text-secondary transition-colors shrink-0' },
  { key: 'objectiveValue', label: 'Objective', className: 'flex-1 text-left hover:text-text-secondary transition-colors' },
  { key: 'duration', label: 'Time', className: 'w-16 text-right hover:text-text-secondary transition-colors shrink-0' },
];

function formatParamValue(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(4) : String(value);
}

function compareTrials(a: TrialResult, b: TrialResult, sortKey: SortKey): number {
  switch (sortKey) {
    case 'trialNumber':
      return a.trialNumber - b.trialNumber;
    case 'objectiveValue':
      return a.objectiveValue - b.objectiveValue;
    case 'duration':
      return a.duration - b.duration;
  }
}

function getApplyButtonClassName(status: ApplyParamsStatus): string {
  if (status === 'success') {
    return 'ui-btn ui-btn-success';
  }
  if (status === 'error') {
    return 'ui-btn ui-btn-danger';
  }
  return 'ui-btn ui-btn-primary';
}

function renderApplyButtonLabel(status: ApplyParamsStatus): ReactNode {
  switch (status) {
    case 'applying':
      return (
        <span className="flex items-center justify-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Applying...
        </span>
      );
    case 'success':
      return 'Applied Successfully';
    case 'error':
      return 'Apply Failed';
    case 'idle':
      return 'Apply Best Parameters';
  }
}

function getTrialRowClassName(isBestTrial: boolean, isEven: boolean): string {
  if (isBestTrial) {
    return 'bg-accent-soft';
  }
  if (isEven) {
    return 'bg-bg-tertiary/15';
  }
  return '';
}

function getObjectiveValueClassName(isBestTrial: boolean): string {
  if (isBestTrial) {
    return 'text-accent';
  }
  return 'text-text-primary';
}

function renderFilterFailures(trial: TrialResult): ReactElement[] {
  const occurrenceCounts = new Map<string, number>();
  return trial.filterFailures.map((failure) => {
    const nextOccurrence = (occurrenceCounts.get(failure) ?? 0) + 1;
    occurrenceCounts.set(failure, nextOccurrence);
    return (
      <div key={`${trial.trialNumber}-${failure}-${nextOccurrence}`} className="pl-3 text-danger/80">
        - {failure}
      </div>
    );
  });
}

function SortIcon({ active, dir }: Readonly<SortIconProps>): ReactElement {
  if (!active) return <span className="text-text-muted/40 ml-0.5">↕</span>;
  return <span className="text-accent ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function ResultsView() {
  const {
    trials,
    bestTrial,
    applyBestParams,
    clearApplyParamsStatus,
    applyParamsStatus,
    applyParamsError,
    resetState,
    error,
  } = useOptimizationStore(
    useShallow((s) => ({
      trials: s.trials,
      bestTrial: s.bestTrial,
      applyBestParams: s.applyBestParams,
      clearApplyParamsStatus: s.clearApplyParamsStatus,
      applyParamsStatus: s.applyParamsStatus,
      applyParamsError: s.applyParamsError,
      resetState: s.resetState,
      error: s.error,
    })),
  );

  const [sortKey, setSortKey] = useState<SortKey>('objectiveValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showOnlyPassed, setShowOnlyPassed] = useState(true);
  const [expandedTrial, setExpandedTrial] = useState<number | null>(null);

  function handleApply() {
    clearApplyParamsStatus();
    applyBestParams();
  }

  const filteredTrials = useMemo(() => {
    const items = showOnlyPassed ? trials.filter((t) => t.passedFilters) : [...trials];
    const multiplier = sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => multiplier * compareTrials(a, b, sortKey));
    return items;
  }, [trials, sortKey, sortDir, showOnlyPassed]);

  const passedCount = trials.filter((t) => t.passedFilters).length;
  const stats = [
    { label: 'Total', value: trials.length, colorClass: 'text-text-primary' },
    { label: 'Passed', value: passedCount, colorClass: 'text-success' },
    { label: 'Failed', value: trials.length - passedCount, colorClass: 'text-danger' },
  ];

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'trialNumber' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="panel-card-stack">
      <div className="panel-card overflow-hidden">
        <PanelCardHeader
          title="Optimization Complete"
          icon={
            <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />

        <div className="panel-card-body">
          <div className="grid gap-7">
            <div className="grid grid-cols-3 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border/45 bg-bg-tertiary/65 p-3 text-center">
                  <div className="text-[11px] text-text-muted mb-1">{stat.label}</div>
                  <div className={`text-[16px] font-mono font-bold ${stat.colorClass}`}>{stat.value}</div>
                </div>
              ))}
            </div>

            {bestTrial && (
              <div>
                <div className="rounded-lg border border-accent/40 bg-accent-soft/75 p-6 shadow-[0_0_18px_rgba(46,201,168,0.2)]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span className="text-[13px] font-semibold text-accent">Best Trial #{bestTrial.trialNumber}</span>
                    </div>
                    <span className="text-[15px] font-mono font-bold text-accent">
                      {bestTrial.objectiveValue.toFixed(4)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {Object.entries(bestTrial.params).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-[11px]">
                        <span className="text-text-secondary">{key}</span>
                        <span className="font-mono text-text-primary font-medium">{formatParamValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(error || applyParamsError) && (
              <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[12px] text-danger">
                {applyParamsError ?? error}
              </div>
            )}

            <div className="pt-1">
              <div className="flex gap-2.5">
                {bestTrial && (
                  <button
                    onClick={handleApply}
                    disabled={applyParamsStatus === 'applying'}
                    className={`flex-1 text-[13px] disabled:opacity-50 ${getApplyButtonClassName(applyParamsStatus)}`}
                  >
                    {renderApplyButtonLabel(applyParamsStatus)}
                  </button>
                )}
                <button
                  onClick={resetState}
                  className="ui-btn ui-btn-secondary px-4 text-[13px]"
                >
                  New Run
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-card overflow-hidden">
        <PanelCardHeader
          title="All Trials"
          icon={
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125"
              />
            </svg>
          }
          right={
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyPassed}
                onChange={(e) => setShowOnlyPassed(e.target.checked)}
                className="sr-only peer"
              />
              <div className="ui-toggle-track" />
              <span className="text-[11px] text-text-muted">Passed only</span>
            </label>
          }
        />

        <div className="flex items-center px-4 py-2.5 border-b border-border/40 text-[11px] text-text-muted bg-bg-tertiary/30">
          {SORT_COLUMNS.map((column) => (
            <button key={column.key} onClick={() => toggleSort(column.key)} className={column.className}>
              {column.label} <SortIcon active={sortKey === column.key} dir={sortDir} />
            </button>
          ))}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {filteredTrials.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-[12px]">No trials to display</div>
          ) : (
            filteredTrials.map((trial, index) => (
              <div key={trial.trialNumber}>
                <button
                  onClick={() => setExpandedTrial(expandedTrial === trial.trialNumber ? null : trial.trialNumber)}
                  className={`w-full flex items-center px-4 py-2.5 text-[12px] border-b border-border/20 hover:bg-bg-hover/50 transition-colors ${
                    getTrialRowClassName(bestTrial?.trialNumber === trial.trialNumber, index % 2 === 0)
                  }`}
                >
                  <span className="w-12 text-left font-mono text-text-muted shrink-0">{trial.trialNumber}</span>
                  <span
                    className={`flex-1 text-left font-mono font-medium ${
                      getObjectiveValueClassName(bestTrial?.trialNumber === trial.trialNumber)
                    }`}
                  >
                    {trial.objectiveValue.toFixed(4)}
                  </span>
                  <span className="w-16 text-right font-mono text-text-muted shrink-0">
                    {(trial.duration / 1000).toFixed(1)}s
                  </span>
                </button>

                {expandedTrial === trial.trialNumber && (
                  <div className="px-4 py-3 bg-bg-tertiary/40 border-b border-border/20">
                    <div className="space-y-1.5">
                      {Object.entries(trial.params).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">{key}</span>
                          <span className="font-mono text-text-secondary">{formatParamValue(value)}</span>
                        </div>
                      ))}
                    </div>
                    {!trial.passedFilters && trial.filterFailures.length > 0 && (
                      <div className="mt-3 text-[11px] text-danger">
                        <div className="font-medium mb-1">Filter failures:</div>
                        {renderFilterFailures(trial)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
