import "./index.css";

function App() {
  return (
    <div className="bg-night-900 min-h-[540px] w-[420px] text-slate-100">
      <header className="border-b border-white/5 px-5 py-4">
        <p className="text-xs tracking-widest text-cyan-300 uppercase">TradingView</p>
        <h1 className="mt-1 text-xl font-semibold">Strategy Optimiser</h1>
      </header>
      <main className="px-5 py-6">
        <p className="text-sm text-slate-400">Welcome to the TradingView Strategy Optimiser</p>
      </main>
    </div>
  );
}

export default App;

