import { useMemo } from "react";
import { useOptimiser } from "../state/optimiserContext";

function SettingsTab() {
  const { state, actions } = useOptimiser();
  const enabledCount = useMemo(
    () => state.parameterOrder.map((id) => state.parameters[id]).filter((param) => param?.enabled).length,
    [state.parameterOrder, state.parameters],
  );

  const hasValidDateRange =
    !state.customRangeEnabled || (state.startDate && state.endDate && state.startDate <= state.endDate);
  const readyToRun = Boolean(state.selectedStrategyId && enabledCount > 0 && hasValidDateRange);

  return (
    <section className="space-y-6 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <span>Optimisation metric</span>
          <select
            value={state.metric}
            onChange={(event) => actions.setMetric(event.target.value)}
            className="bg-night-800/80 w-full rounded-md border border-white/10 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            <option value="net-profit">Net Profit</option>
            <option value="profit-factor">Profit Factor</option>
            <option value="sharpe">Sharpe Ratio</option>
            <option value="sortino">Sortino Ratio</option>
            <option value="max-dd-pct">Max Drawdown %</option>
            <option value="win-rate">Win Rate %</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <span>Number of trials</span>
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
                  <option value="net-profit">Net Profit</option>
                  <option value="profit-factor">Profit Factor</option>
                  <option value="max-dd-pct">Max Drawdown %</option>
                  <option value="win-rate">Win Rate %</option>
                </select>
                <select
                  value={filter.comparator}
                  onChange={(event) => actions.updateFilter(filter.id, "comparator", event.target.value)}
                  className="bg-night-800 rounded-md border border-white/10 px-2 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value=">=">≥</option>
                  <option value="<=">≤</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value="=">=</option>
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
          className="text-night-900 rounded-md bg-cyan-500 px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
        >
          Start optimisation
        </button>
      </div>
    </section>
  );
}

export default SettingsTab;

