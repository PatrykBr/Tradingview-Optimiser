import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { BackgroundRequest, BackgroundResponse, StrategyParameter, StrategySummary } from "@shared/ipc";

function StrategyTab() {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [parameters, setParameters] = useState<StrategyParameter[]>([]);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [isLoadingParams, setIsLoadingParams] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategies = async () => {
    setIsLoadingStrategies(true);
    setError(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "list-strategies",
      } as BackgroundRequest)) as BackgroundResponse;
      
      if (response.type === "strategies") {
        setStrategies(response.strategies);
      } else if (response.type === "error") {
        setError(response.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategies");
    } finally {
      setIsLoadingStrategies(false);
    }
  };

  const loadParameters = async (strategyId: string) => {
    setIsLoadingParams(true);
    setError(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "get-params",
        strategyId,
      } as BackgroundRequest)) as BackgroundResponse;
      
      if (response.type === "params") {
        setParameters(response.params);
      } else if (response.type === "error") {
        setError(response.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parameters");
    } finally {
      setIsLoadingParams(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  useEffect(() => {
    if (selectedStrategyId) {
      loadParameters(selectedStrategyId);
    } else {
      setParameters([]);
    }
  }, [selectedStrategyId]);

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs tracking-wide text-slate-400 uppercase">Selected strategy</label>
          <select
            value={selectedStrategyId}
            onChange={(e) => setSelectedStrategyId(e.target.value)}
            className="bg-night-800/80 mt-1 w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            <option value="">Choose a strategy</option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={loadStrategies}
          disabled={isLoadingStrategies}
          className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50"
        >
          {isLoadingStrategies ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 rounded-lg border border-rose-500/40 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {isLoadingParams && (
        <div className="bg-night-800/60 rounded-lg border border-cyan-500/20 px-4 py-3 text-sm text-cyan-100">
          Pulling parameters from TradingView…
        </div>
      )}

      {!isLoadingParams && parameters.length > 0 && (
        <div className="space-y-4">
          {parameters.map((param) => (
            <div
              key={param.id}
              className="bg-night-800/60 rounded-xl border border-white/5 p-4"
            >
              <div className="text-sm font-semibold text-slate-100">{param.label}</div>
              <p className="text-xs text-slate-400">Type: {param.type}</p>
              <p className="text-xs text-slate-400">Current value: {String(param.value)}</p>
            </div>
          ))}
        </div>
      )}

      {!isLoadingParams && selectedStrategyId && parameters.length === 0 && (
        <div className="bg-night-800/60 rounded-lg border border-white/10 px-4 py-3 text-sm text-slate-300">
          No parameters found for this strategy.
        </div>
      )}

      {!selectedStrategyId && (
        <div className="bg-night-800/60 rounded-lg border border-white/10 px-4 py-3 text-sm text-slate-300">
          Select a strategy to inspect its parameters.
        </div>
      )}
    </section>
  );
}

export default StrategyTab;

