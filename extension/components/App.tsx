import { useEffect, useMemo, useState } from 'react';

import type { BackgroundMessage } from '../lib/messages';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { DetectedStrategy, StrategyInput } from '../lib/tradingview/types';
import './App.css';

export default function App() {
  const adapter = useMemo(() => new TradingViewAdapter(), []);
  const [strategies, setStrategies] = useState<DetectedStrategy[]>([]);
  const [selected, setSelected] = useState('');
  const [inputs, setInputs] = useState<StrategyInput[]>([]);
  const [connected, setConnected] = useState(false);
  const [optunaVersion, setOptunaVersion] = useState<string>();
  const [error, setError] = useState<string>();

  const probe = async () => {
    setError(undefined);
    const detected = adapter.detectStrategies();
    setStrategies(detected);
    if (detected.length === 1) setSelected(detected[0]!.name);
  };

  const readInputs = async () => {
    if (!selected) return;
    try {
      setInputs(await adapter.readStrategyInputs(selected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void probe();
    void browser.runtime.sendMessage({ type: 'BACKEND_CONNECT' });
    const listener = (message: BackgroundMessage) => {
      if (message.type === 'BACKEND_STATE') {
        setConnected(message.connected);
        setOptunaVersion(message.optunaVersion);
      }
      if (message.type === 'BACKEND_ERROR') setError(message.message);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <main className="panel">
      <header>
        <div>
          <div className="eyebrow">TRADINGVIEW</div>
          <h1>Optuna Optimiser</h1>
        </div>
        <span className={connected ? 'status connected' : 'status'}>
          {connected ? 'Optuna ' + (optunaVersion ?? 'connected') : 'Backend offline'}
        </span>
      </header>

      <section>
        <div className="rowLabel">
          <label htmlFor="strategy">Strategy</label>
          <button className="textButton" onClick={() => void probe()}>Refresh</button>
        </div>
        <select id="strategy" value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Select strategy…</option>
          {strategies.map((strategy) => (
            <option key={strategy.name} value={strategy.name}>{strategy.name}</option>
          ))}
        </select>
        <button className="primary" disabled={!selected} onClick={() => void readInputs()}>
          Read strategy inputs
        </button>
      </section>

      {inputs.length > 0 && (
        <section>
          <div className="rowLabel"><strong>Detected inputs</strong><span>{inputs.length}</span></div>
          <div className="inputList">
            {inputs.map((input) => (
              <div className="inputRow" key={input.id}>
                <div><strong>{input.label}</strong><small>{input.type}</small></div>
                <code>{String(input.currentValue)}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}
      <footer>First vertical slice: live strategy and input probe.</footer>
    </main>
  );
}
