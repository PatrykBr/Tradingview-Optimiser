function StrategyTab() {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs tracking-wide text-slate-400 uppercase">Selected strategy</label>
          <select className="bg-night-800/80 mt-1 w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none">
            <option value="">Choose a strategy</option>
          </select>
        </div>
        <button
          type="button"
          className="rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
        >
          Refresh
        </button>
      </div>

      <div className="bg-night-800/60 rounded-lg border border-white/10 px-4 py-3 text-sm text-slate-300">
        Select a strategy to inspect its parameters.
      </div>
    </section>
  );
}

export default StrategyTab;

