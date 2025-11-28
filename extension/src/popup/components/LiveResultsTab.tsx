import { useState } from "react";
import { METRIC_TO_PROPERTY } from "@shared/metrics";
import { METRIC_OPTIONS } from "../constants";
import { useOptimiser } from "../state/optimiserContext";
import { cn } from "../utils/cn";

const metricLabels: Record<string, string> = Object.fromEntries(METRIC_OPTIONS.map((m) => [m.id, m.label]));

function LiveResultsTab() {
  const { state, actions } = useOptimiser();
  const [isApplyingBest, setIsApplyingBest] = useState(false);
  const completed = state.completedTrials.length;
  const progress = state.totalTrials > 0 ? (completed / state.totalTrials) * 100 : 0;
  const best = state.bestTrial;
  const metricProp = METRIC_TO_PROPERTY[state.metric];
  const canApplyBest = Boolean(best && (state.status === "completed" || state.status === "stopped"));

  async function handleApplyBest() {
    if (!canApplyBest) return;
    setIsApplyingBest(true);
    try {
      await actions.applyBestToChart();
    } finally {
      setIsApplyingBest(false);
    }
  }

  return (
    <section className="space-y-4 text-sm">
      <div className="bg-night-800/80 rounded-xl border border-cyan-500/30 p-4 shadow-lg">
        <div className="flex items-center justify-between text-xs tracking-wider text-cyan-200 uppercase">
          <span>Best result so far</span>
          <span>{metricLabels[state.metric]}</span>
        </div>
        {best ? (
          <div className="mt-2">
            <p className="text-2xl font-semibold text-white">{best.metrics[metricProp] ?? "—"}</p>
            <p className="text-xs text-slate-400">
              Trial #{best.trial} ·{" "}
              {best.passedFilters
                ? "Passed all filters"
                : (best.filterReasons?.length ? best.filterReasons : ["Failed configured filters"]).join(" • ")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
              {Object.entries(best.params).map(([key, value]) => (
                <div key={key} className="rounded-md border border-white/5 bg-black/20 px-2 py-1">
                  <p className="text-[10px] tracking-widest text-slate-400 uppercase">{key}</p>
                  <p className="font-semibold text-slate-100">{String(value)}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            No trials have completed yet. Kick off an optimisation to see live results.
          </p>
        )}
      </div>

      {canApplyBest && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-emerald-200">Ready to deploy the winner?</p>
              <p className="text-xs text-emerald-100/80">
                Apply the best-performing parameters straight onto your TradingView chart.
              </p>
            </div>
            <button
              type="button"
              onClick={handleApplyBest}
              disabled={isApplyingBest}
              className="inline-flex items-center justify-center rounded-md border border-emerald-300/60 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplyingBest ? "Applying..." : "Apply Best to Chart"}
            </button>
          </div>
        </div>
      )}

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
            <table className="w-full text-xs">
              <thead className="bg-night-900 sticky top-0 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Trial</th>
                  <th className="px-3 py-2 text-left font-medium">{metricLabels[state.metric]}</th>
                  <th className="px-3 py-2 text-left font-medium">Filter notes</th>
                </tr>
              </thead>
              <tbody>
                {state.completedTrials.map((trial) => {
                  return (
                    <tr
                      key={trial.id}
                      className={cn(
                        "border-t border-white/5",
                        trial.passedFilters ? "bg-emerald-500/10 text-emerald-100" : "bg-rose-500/5 text-rose-100",
                      )}
                    >
                      <td className="px-3 py-2 font-semibold text-white">#{trial.trial}</td>
                      <td className="px-3 py-2">{trial.metrics[metricProp]?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="space-y-0.5 text-[10px] text-white/80">
                          {(trial.passedFilters
                            ? ["Passed all filters"]
                            : trial.filterReasons?.length
                              ? trial.filterReasons
                              : ["Failed configured filters"]
                          ).map((line, idx) => (
                            <p key={idx}>{line}</p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

export default LiveResultsTab;
