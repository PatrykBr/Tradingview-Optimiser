import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { BackgroundRequest, BackgroundResponse, StrategySummary } from "@shared/ipc";

function StrategyTab() {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategies = async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs tracking-wide text-slate-400 uppercase">Selected strategy</label>
          <select className="bg-night-800/80 mt-1 w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none">
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
          disabled={isLoading}
          className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50"
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 rounded-lg border border-rose-500/40 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {!error && strategies.length === 0 && !isLoading && (
        <div className="bg-night-800/60 rounded-lg border border-white/10 px-4 py-3 text-sm text-slate-300">
          Select a strategy to inspect its parameters.
        </div>
      )}
    </section>
  );
}

export default StrategyTab;

