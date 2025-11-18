function LiveResultsTab() {
  return (
    <section className="space-y-4 text-sm">
      <div className="bg-night-800/80 rounded-xl border border-cyan-500/30 p-4 shadow-lg">
        <div className="flex items-center justify-between text-xs tracking-wider text-cyan-200 uppercase">
          <span>Best result so far</span>
          <span>Net Profit</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          No trials have completed yet. Kick off an optimisation to see live results.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>0 / 0 trials</span>
          <span>0.0%</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-white/10">
          <div className="h-full rounded-full bg-linear-to-r from-cyan-400 to-sky-500" style={{ width: "0%" }} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm font-semibold text-slate-400 disabled:cursor-not-allowed"
        >
          Stop
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          Adjust Settings
        </button>
      </div>

      <div className="bg-night-900/70 rounded-xl border border-white/5">
        <div className="border-b border-white/5 px-4 py-2 text-xs font-semibold tracking-widest text-slate-400 uppercase">
          Trial history
        </div>
        <div className="px-4 py-6 text-center text-xs text-slate-500">
          Results will stream here during optimisation.
        </div>
      </div>
    </section>
  );
}

export default LiveResultsTab;

