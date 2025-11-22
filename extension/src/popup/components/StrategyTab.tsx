import { useMemo } from "react";
import { useOptimiser } from "../state/optimiserContext";

const typeColours: Record<string, string> = {
  int: "bg-amber-500/15 text-amber-200",
  float: "bg-emerald-500/15 text-emerald-200",
  bool: "bg-slate-500/15 text-slate-200",
  string: "bg-sky-500/15 text-sky-100",
};

function formatValue(value: string | number | boolean) {
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  return String(value);
}

function StrategyTab() {
  const { state, actions } = useOptimiser();
  const parameters = useMemo(
    () => state.parameterOrder.map((id) => state.parameters[id]).filter(Boolean),
    [state.parameterOrder, state.parameters],
  );

  const selectedCount = parameters.filter((param) => param.enabled).length;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs tracking-wide text-slate-400 uppercase">Selected strategy</label>
          <select
            value={state.selectedStrategyId ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              actions.selectStrategy(value || undefined);
            }}
            className="bg-night-800/80 mt-1 w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            <option value="">Choose a strategy</option>
            {state.strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => actions.loadStrategies()}
          className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
        >
          Refresh
        </button>
      </div>

      {state.isLoadingParams && (
        <div className="bg-night-800/60 rounded-lg border border-cyan-500/20 px-4 py-3 text-sm text-cyan-100">
          Pulling parameters from TradingView…
        </div>
      )}

      {!state.isLoadingParams && parameters.length === 0 && (
        <div className="bg-night-800/60 rounded-lg border border-white/10 px-4 py-3 text-sm text-slate-300">
          Select a strategy to inspect its parameters.
        </div>
      )}

      {parameters.length > 0 && (
        <div className="space-y-4">
          {parameters.map((param) => {
            const supportsRange = param.definition.type === "int" || param.definition.type === "float";
            return (
              <div
                key={param.definition.id}
                className="bg-night-800/60 rounded-xl border border-white/5 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      {param.definition.label}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColours[param.definition.type] ?? "bg-slate-600/30 text-slate-200"}`}
                      >
                        {param.definition.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Current value: {formatValue(param.definition.value)}</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <input
                      type="checkbox"
                      className="bg-night-900 h-4 w-4 rounded border-white/20 text-cyan-400 focus:ring-0"
                      checked={param.enabled}
                      disabled={!supportsRange}
                      onChange={(event) => actions.toggleParameter(param.definition.id, event.target.checked)}
                    />
                    Optimise
                  </label>
                </div>

                {param.enabled && supportsRange && (
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    {(["min", "max"] as const).map((field) => (
                      <label key={field} className="text-xs tracking-wider text-slate-400 uppercase">
                        {field === "min" ? "Minimum" : "Maximum"}
                        <input
                          type="number"
                          step={param.definition.type === "int" ? 1 : 0.1}
                          value={param[field]}
                          onChange={(event) =>
                            actions.updateParameterRange(param.definition.id, field, event.target.value)
                          }
                          className="bg-night-900 mt-1 w-full rounded-md border border-white/10 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                )}

                {!supportsRange && (
                  <p className="mt-3 text-xs text-amber-300/80">
                    This parameter type will be supported in a future revision.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        <div className="text-xs text-slate-400">
          {selectedCount} parameter{selectedCount === 1 ? "" : "s"} selected
        </div>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => actions.setTab("settings")}
          className="text-night-900 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
        >
          Next
        </button>
      </div>
    </section>
  );
}

export default StrategyTab;

