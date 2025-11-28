import { useMemo } from "react";
import type { StrategyMetric } from "@shared/ipc";
import { METRIC_OPTIONS, FILTER_COMPARATORS } from "../constants";
import { useOptimiser } from "../state/optimiserContext";

function formatMetricLabel(metric: StrategyMetric): string {
  return (
    METRIC_OPTIONS.find((o) => o.id === metric)?.label ??
    metric
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ")
  );
}

function buildMetricOptions(
  favourites: StrategyMetric[],
  ensureVisible: StrategyMetric[],
): Array<{ id: StrategyMetric; displayLabel: string }> {
  const favouriteSet = new Set(favourites);

  // Add any missing metrics that need to be visible
  const allMetrics = [...METRIC_OPTIONS];
  for (const metric of ensureVisible) {
    if (!allMetrics.some((m) => m.id === metric)) {
      allMetrics.push({ id: metric, label: formatMetricLabel(metric) });
    }
  }

  const decorated = allMetrics.map((option) => ({
    id: option.id,
    displayLabel: favouriteSet.has(option.id) ? `⭐ ${option.label}` : option.label,
  }));

  // Sort favourites first
  return [...decorated.filter((o) => favouriteSet.has(o.id)), ...decorated.filter((o) => !favouriteSet.has(o.id))];
}

function SettingsTab() {
  const { state, actions } = useOptimiser();
  const enabledCount = state.parameterOrder.map((id) => state.parameters[id]).filter((param) => param?.enabled).length;

  const hasValidDateRange =
    !state.customRangeEnabled || (state.startDate && state.endDate && state.startDate <= state.endDate);
  const readyToRun = Boolean(state.selectedStrategyId && enabledCount > 0 && hasValidDateRange);

  const ensureVisibleMetricIds = useMemo(
    () => [state.metric, ...state.filters.map((f) => f.metric)],
    [state.metric, state.filters],
  );

  const metricOptions = useMemo(
    () => buildMetricOptions(state.favouriteMetrics, ensureVisibleMetricIds),
    [state.favouriteMetrics, ensureVisibleMetricIds],
  );

  const isCurrentMetricFavourite = state.favouriteMetrics.includes(state.metric);

  return (
    <section className="space-y-6 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <div className="flex min-h-7 items-center justify-between gap-2 leading-none">
            <span className="whitespace-nowrap">Optimisation metric</span>
            <button
              type="button"
              onClick={() => void actions.toggleFavouriteMetric(state.metric)}
              className="flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[13px] text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-100"
              title={isCurrentMetricFavourite ? "Remove this metric from favourites" : "Add this metric to favourites"}
              aria-label={
                isCurrentMetricFavourite
                  ? "Remove optimisation metric from favourites"
                  : "Add optimisation metric to favourites"
              }
            >
              <span aria-hidden="true">{isCurrentMetricFavourite ? "⭐" : "☆"}</span>
            </button>
          </div>
          <select
            value={state.metric}
            onChange={(event) => actions.setMetric(event.target.value as typeof state.metric)}
            className="bg-night-800/80 w-full rounded-md border border-white/10 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            {metricOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <div className="flex min-h-7 items-center justify-between gap-2 leading-none">
            <span className="whitespace-nowrap">Number of trials</span>
            <span aria-hidden="true" className="inline-flex w-9" />
          </div>
          <input
            type="number"
            min={10}
            max={2000}
            value={state.trials}
            onChange={(event) => actions.setTrials(Number(event.target.value))}
            className="bg-night-800/80 w-full rounded-md border border-white/10 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="bg-night-800/70 rounded-xl border border-white/5 p-4">
        <label className="flex items-center gap-3 text-sm font-semibold text-slate-100">
          <input
            type="checkbox"
            checked={state.customRangeEnabled}
            onChange={(event) => actions.toggleCustomRange(event.target.checked)}
            className="bg-night-900 h-4 w-4 rounded border-white/20 text-cyan-400 focus:ring-0"
          />
          Use custom date range
        </label>
        {state.customRangeEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-4 text-xs tracking-wider text-slate-400 uppercase">
            <label>
              Start date
              <input
                type="date"
                value={state.startDate ?? ""}
                onChange={(event) => actions.setDate("start", event.target.value || undefined)}
                className="bg-night-900 mt-1 w-full rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={state.endDate ?? ""}
                onChange={(event) => actions.setDate("end", event.target.value || undefined)}
                className="bg-night-900 mt-1 w-full rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
            </label>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Result filters</h3>
          <button
            type="button"
            onClick={() => actions.addFilter()}
            className="text-xs font-semibold text-cyan-300 hover:text-cyan-100"
          >
            + Add filter
          </button>
        </div>
        {state.filters.length === 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Optional: constrain acceptable results (e.g. Max Drawdown ≤ 25%).
          </p>
        )}
        <div className="mt-3 space-y-3">
          {state.filters.map((filter) => (
            <div
              key={filter.id}
              className="bg-night-900/70 rounded-lg border border-white/10 p-3 text-xs tracking-wider text-slate-400 uppercase"
            >
              <div className="grid grid-cols-[2fr,auto,1fr,auto] items-center gap-2">
                <select
                  value={filter.metric}
                  onChange={(event) => actions.updateFilter(filter.id, "metric", event.target.value)}
                  className="bg-night-800 rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {metricOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayLabel}
                    </option>
                  ))}
                </select>
                <select
                  value={filter.comparator}
                  onChange={(event) => actions.updateFilter(filter.id, "comparator", event.target.value)}
                  className="bg-night-800 rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {FILTER_COMPARATORS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={filter.value}
                  onChange={(event) => actions.updateFilter(filter.id, "value", event.target.value)}
                  className="bg-night-800 rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-300"
                  onClick={() => actions.removeFilter(filter.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4 text-xs text-slate-400">
        <span>
          {enabledCount} parameter{enabledCount === 1 ? "" : "s"} queued
        </span>
        <button
          type="button"
          disabled={!readyToRun}
          onClick={() => actions.startOptimisation()}
          className="text-night-900 rounded-md bg-linear-to-r from-cyan-400 to-sky-500 px-5 py-2 text-sm font-semibold shadow-lg shadow-cyan-500/30 disabled:cursor-not-allowed disabled:bg-slate-600/40 disabled:text-slate-400"
        >
          Start optimisation
        </button>
      </div>
    </section>
  );
}

export default SettingsTab;
