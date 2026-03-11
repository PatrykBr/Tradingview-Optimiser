import { useEffect, useMemo, useState } from 'react';
import { useOptimizationStore } from '../store';
import type { Filter, StrategyParameter } from '../../shared/types';
import { buildSearchSpace, resolveStudyIdentity } from '../../shared/study-signature';
import { useShallow } from 'zustand/react/shallow';
import CollapsiblePanelCard from './CollapsiblePanelCard';

function resolveCurrentFamilyName(args: {
  strategyName: string;
  targetMetric: string;
  targetMetricDirection: 'maximize' | 'minimize';
  targetMetricColumn: 'all' | 'long' | 'short';
  parameters: StrategyParameter[];
  filters: Filter[];
}): string | null {
  if (!args.strategyName) return null;
  const searchSpace = buildSearchSpace(args.parameters);
  if (searchSpace.length === 0) return null;
  return resolveStudyIdentity(
    {
      strategyName: args.strategyName,
      runMode: 'fresh',
      targetMetric: args.targetMetric,
      targetMetricDirection: args.targetMetricDirection,
      targetMetricColumn: args.targetMetricColumn,
      filters: args.filters,
    },
    searchSpace,
  ).familyName;
}

export default function HistoryManager() {
  const {
    historyRuns,
    runMode,
    strategyName,
    targetMetric,
    targetMetricDirection,
    targetMetricColumn,
    parameters,
    filters,
    selectedHistoryRunIds,
    setSelectedHistoryRunIds,
    toggleHistoryRunSelection,
    clearHistoryRunSelection,
    clearHistory,
    deleteHistoryRun,
  } = useOptimizationStore(
    useShallow((s) => ({
      historyRuns: s.historyRuns,
      runMode: s.runMode,
      strategyName: s.strategyName,
      targetMetric: s.targetMetric,
      targetMetricDirection: s.targetMetricDirection,
      targetMetricColumn: s.targetMetricColumn,
      parameters: s.parameters,
      filters: s.filters,
      selectedHistoryRunIds: s.selectedHistoryRunIds,
      setSelectedHistoryRunIds: s.setSelectedHistoryRunIds,
      toggleHistoryRunSelection: s.toggleHistoryRunSelection,
      clearHistoryRunSelection: s.clearHistoryRunSelection,
      clearHistory: s.clearHistory,
      deleteHistoryRun: s.deleteHistoryRun,
    })),
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (runMode === 'warm_start') {
      setOpen(true);
    }
  }, [runMode]);

  const sortedRuns = useMemo(() => [...historyRuns].sort((a, b) => b.completedAt - a.completedAt), [historyRuns]);
  const currentFamilyName = useMemo(
    () =>
      resolveCurrentFamilyName({
        strategyName,
        targetMetric,
        targetMetricDirection,
        targetMetricColumn,
        parameters,
        filters,
      }),
    [strategyName, targetMetric, targetMetricDirection, targetMetricColumn, parameters, filters],
  );
  const visibleRuns = useMemo(() => {
    if (runMode !== 'warm_start' || !currentFamilyName) return sortedRuns;
    return sortedRuns.filter((run) => run.familyName === currentFamilyName);
  }, [runMode, currentFamilyName, sortedRuns]);
  const visibleRunIds = useMemo(() => new Set(visibleRuns.map((run) => run.id)), [visibleRuns]);

  useEffect(() => {
    if (runMode !== 'warm_start') return;
    const pruned = selectedHistoryRunIds.filter((id) => visibleRunIds.has(id));
    const unchanged =
      pruned.length === selectedHistoryRunIds.length &&
      pruned.every((id, index) => id === selectedHistoryRunIds[index]);
    if (!unchanged) {
      setSelectedHistoryRunIds(pruned);
    }
  }, [runMode, selectedHistoryRunIds, setSelectedHistoryRunIds, visibleRunIds]);

  const hasHistory = historyRuns.length > 0;
  const hasVisibleHistory = visibleRuns.length > 0;
  const totalTrials = useMemo(() => historyRuns.reduce((sum, run) => sum + run.trials.length, 0), [historyRuns]);
  const visibleTrials = useMemo(() => visibleRuns.reduce((sum, run) => sum + run.trials.length, 0), [visibleRuns]);
  const hiddenIncompatibleRuns = runMode === 'warm_start' ? Math.max(0, historyRuns.length - visibleRuns.length) : 0;
  const selectedCount = selectedHistoryRunIds.filter((id) => visibleRunIds.has(id)).length;
  let summaryText = 'No saved runs';
  if (hasHistory) {
    summaryText =
      runMode === 'warm_start'
        ? `${visibleRuns.length} compatible runs`
        : `${historyRuns.length} runs • ${totalTrials} trials`;
  }
  let warmStartSelectionText = 'No compatible run history yet';
  if (hasVisibleHistory) {
    warmStartSelectionText = selectedCount > 0 ? `${selectedCount} selected` : 'None selected (will run fresh)';
  }
  const hiddenIncompatibleRunSuffix = hiddenIncompatibleRuns === 1 ? '' : 's';

  if (!hasHistory && runMode !== 'warm_start') return null;

  return (
    <CollapsiblePanelCard
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      title="Trial History"
      icon={
        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5h16.5m-16.5 5.25h16.5m-16.5 5.25h16.5M3.75 19.5h16.5" />
        </svg>
      }
      summary={summaryText}
    >
      <div className="panel-card-body border-b border-border/40 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="ui-note">Warm start reuses selected compatible runs.</p>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
          {runMode === 'warm_start' && hasVisibleHistory && (
            <>
              <button
                onClick={() => setSelectedHistoryRunIds(visibleRuns.map((run) => run.id))}
                className="ui-btn ui-btn-ghost min-h-7 whitespace-nowrap px-2 py-1 text-[11px]"
              >
                Select All
              </button>
              <button
                onClick={clearHistoryRunSelection}
                className="ui-btn ui-btn-ghost min-h-7 whitespace-nowrap px-2 py-1 text-[11px]"
              >
                Clear Selection
              </button>
            </>
          )}
          {runMode === 'warm_start' && (
            <button
              onClick={() => clearHistory(true)}
              disabled={!currentFamilyName || !hasVisibleHistory}
              className="ui-btn ui-btn-ghost min-h-7 whitespace-nowrap px-2 py-1 text-[11px] disabled:opacity-40"
              title="Clear compatible history for this exact setup"
            >
              Clear Matching
            </button>
          )}
          <button
            onClick={() => clearHistory(false)}
            disabled={!hasHistory}
            className="ui-btn ui-btn-danger min-h-7 whitespace-nowrap px-2 py-1 text-[11px] disabled:opacity-40"
          >
            Clear All
          </button>
        </div>
      </div>

      {runMode === 'warm_start' && (
        <div className="px-4 py-2.5 border-b border-border/40 bg-bg-tertiary/30 text-[11px] text-text-muted">
          Warm-start source runs:{' '}
          <span className="text-text-secondary font-medium">{warmStartSelectionText}</span>
          {hasVisibleHistory && <span className="text-text-muted"> • {visibleTrials} trials</span>}
        </div>
      )}

      {runMode === 'warm_start' && hiddenIncompatibleRuns > 0 && (
        <div className="px-4 py-2 border-b border-border/40 bg-bg-tertiary/10 text-[11px] text-text-muted">
          Hidden {hiddenIncompatibleRuns} incompatible run{hiddenIncompatibleRunSuffix} (different
          objective/search space/filters).
        </div>
      )}

      <div className="divide-y divide-border/40 max-h-52 overflow-y-auto">
        {hasVisibleHistory ? (
          visibleRuns.map((run) => (
            <div key={run.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2">
                  {runMode === 'warm_start' && (
                    <input
                      type="checkbox"
                      checked={selectedHistoryRunIds.includes(run.id)}
                      onChange={() => toggleHistoryRunSelection(run.id)}
                      className="ui-checkbox"
                      title="Use this run for warm-start"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] text-text-primary truncate">{run.strategyName}</div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {run.trials.length} trials • {run.runMode} • {new Date(run.completedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => deleteHistoryRun(run.id)}
                  className="ui-btn ui-btn-ghost min-h-7 shrink-0 px-2 py-1 text-[11px] hover:text-danger"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-4 text-[11px] text-text-muted">
            {hasHistory
              ? 'No compatible history for the current setup. Run a fresh optimization first or adjust warm-start settings.'
              : 'Run a fresh optimization first, then warm start can reuse that history.'}
          </div>
        )}
      </div>

      {runMode === 'warm_start' && (
        <div className="px-4 py-2.5 border-t border-border/40 bg-bg-tertiary/20 text-[11px] text-text-muted">
          Only runs shown here are eligible for this warm start. If nothing is selected, this run starts fresh.
        </div>
      )}
    </CollapsiblePanelCard>
  );
}
