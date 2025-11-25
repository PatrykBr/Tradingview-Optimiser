import "./index.css";
import { OptimiserProvider, useOptimiser } from "./state/optimiserContext";
import TabsNav from "./components/TabsNav";
import StrategyTab from "./components/StrategyTab";
import SettingsTab from "./components/SettingsTab";
import LiveResultsTab from "./components/LiveResultsTab";

function PopupShell() {
  const { state, actions } = useOptimiser();

  return (
    <div className="bg-night-900 min-h-[540px] w-[420px] text-slate-100 shadow-2xl">
      <header className="border-b border-white/5 px-5 py-4">
        <p className="text-xs tracking-widest text-cyan-300 uppercase">TradingView</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Strategy Optimiser</h1>
          <span className="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-200">
            {state.status.toUpperCase()}
          </span>
        </div>
      </header>

      {state.error && (
        <div className="mx-5 mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {state.error}
        </div>
      )}

      <TabsNav activeTab={state.tab} onTabChange={actions.setTab} />

      <main className="h-[420px] overflow-y-auto px-5 pt-4 pb-6">
        {state.tab === "parameters" && <StrategyTab />}
        {state.tab === "settings" && <SettingsTab />}
        {state.tab === "results" && <LiveResultsTab />}
      </main>
    </div>
  );
}

function App() {
  return (
    <OptimiserProvider>
      <PopupShell />
    </OptimiserProvider>
  );
}

export default App;
