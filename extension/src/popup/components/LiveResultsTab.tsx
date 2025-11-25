import { useMemo } from "react";
import { useOptimiser } from "../state/optimiserContext";

function LiveResultsTab() {
  const { state, actions } = useOptimiser();
  const completed = state.completedTrials.length;
  const progress = state.totalTrials > 0 ? (completed / state.totalTrials) * 100 : 0;
  const best = state.bestTrial;

  return (
    <section className="space-y-4 text-sm">
      <div className="bg-night-800/80 rounded-xl border border-cyan-500/30 p-4 shadow-lg">
        <div className="flex items-center justify-between text-xs tracking-wider text-cyan-200 uppercase">
          <span>Best result so far</span>
          <span>{state.metric}</span>
        </div>
        {best ? (
          <div className="mt-2">
            <p className="text-2xl font-semibold text-white">
              {best.metrics.netProfit?.toFixed(2) ?? "—"}
            </p>
            <p className="text-xs text-slate-400">Trial #{best.trial}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            No trials have completed yet. Kick off an optimisation to see live results.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {completed} / {state.totalTrials || "∞"} trials
          </span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-linear-to-r from-cyan-400 to-sky-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={state.status !== "running"}
          onClick={() => actions.stopOptimisation()}
          className="flex-1 rounded-md border border-rose-500/50 px-3 py-2 text-sm font-semibold text-rose-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-400"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => actions.setTab("settings")}
          className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          Adjust Settings
        </button>
      </div>

      <div className="bg-night-900/70 rounded-xl border border-white/5">
        <div className="border-b border-white/5 px-4 py-2 text-xs font-semibold tracking-widest text-slate-400 uppercase">
          Trial history
        </div>
        <div className="max-h-56 overflow-y-auto">
          {state.completedTrials.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              Results will stream here during optimisation.
            </p>
          ) : (
            <div className="space-y-1 p-2">
              {state.completedTrials.map((trial) => (
                <div
                  key={trial.id}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    trial.passedFilters
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-100"
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-semibold">Trial #{trial.trial}</span>
                    <span>{trial.metrics.netProfit?.toFixed(2) ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default LiveResultsTab;

