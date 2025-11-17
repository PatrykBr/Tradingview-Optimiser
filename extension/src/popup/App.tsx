import { useState } from "react";
import "./index.css";
import TabsNav from "./components/TabsNav";
import StrategyTab from "./components/StrategyTab";

type TabId = "parameters" | "settings" | "results";

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("parameters");

  return (
    <div className="bg-night-900 min-h-[540px] w-[420px] text-slate-100 shadow-2xl">
      <header className="border-b border-white/5 px-5 py-4">
        <p className="text-xs tracking-widest text-cyan-300 uppercase">TradingView</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Strategy Optimiser</h1>
          <span className="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-200">
            IDLE
          </span>
        </div>
      </header>

      <TabsNav activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="h-[420px] overflow-y-auto px-5 pt-4 pb-6">
        {activeTab === "parameters" && <StrategyTab />}
        {activeTab === "settings" && <div className="text-sm text-slate-400">Settings tab coming soon...</div>}
        {activeTab === "results" && <div className="text-sm text-slate-400">Results tab coming soon...</div>}
      </main>
    </div>
  );
}

export default App;
