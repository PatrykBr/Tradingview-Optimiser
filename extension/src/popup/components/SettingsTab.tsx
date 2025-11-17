function SettingsTab() {
  return (
    <section className="space-y-6 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <span>Optimisation metric</span>
          <select className="bg-night-800/80 w-full rounded-md border border-white/10 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none">
            <option value="net-profit">Net Profit</option>
            <option value="profit-factor">Profit Factor</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-xs tracking-wider text-slate-400 uppercase">
          <span>Number of trials</span>
          <input
            type="number"
            min={10}
            max={2000}
            defaultValue={250}
            className="bg-night-800/80 w-full rounded-md border border-white/10 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4 text-xs text-slate-400">
        <span>0 parameters queued</span>
        <button
          type="button"
          disabled
          className="text-night-900 rounded-md bg-slate-600/40 px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Start optimisation
        </button>
      </div>
    </section>
  );
}

export default SettingsTab;

