import React, { useState, useEffect } from 'react';
import Header from '../components/Header';
import StrategySelector from '../components/StrategySelector';
import SettingsPanel from '../components/SettingsPanel';
import OptimizationPanel from '../components/OptimizationPanel';
import FiltersPanel from '../components/FiltersPanel';
import ResultsPanel from '../components/ResultsPanel';
import LogsPanel from '../components/LogsPanel';
import { useOptimization } from '../hooks/useOptimization';
import { useTradingView } from '../hooks/useTradingView';

function App() {
  const [activeView, setActiveView] = useState('setup');
  const [configs, setConfigs] = useState([]);
  const [currentConfigName, setCurrentConfigName] = useState('');
  const [newConfigName, setNewConfigName] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const {
    strategies,
    selectedStrategy,
    strategySettings,
    isLoadingStrategies,
    isLoadingSettings,
    selectStrategy,
    refreshStrategies,
    refreshSettings
  } = useTradingView();

  const {
    optimizationState,
    optimizationSettings,
    filters,
    results,
    logs,
    progress,
    startOptimization,
    stopOptimization,
    updateOptimizationSettings,
    addFilter,
    removeFilter,
    clearResults
  } = useOptimization();

  // Calculate best result dynamically
  const bestResult = React.useMemo(() => {
    if (results.length === 0) return null;
    
    const validResults = results.filter(r => r.isValid);
    if (validResults.length === 0) return null;
    
    // For metrics that should be maximized (like net profit, profit factor)
    const isMaximizeMetric = ['netProfit', 'grossProfit', 'profitFactor', 'sharpeRatio'].includes(optimizationSettings.metric);
    
    let best = validResults[0];
    for (const result of validResults) {
      if (isMaximizeMetric) {
        if (result.value > best.value) {
          best = result;
        }
      } else {
        if (result.value < best.value) {
          best = result;
        }
      }
    }
    
    return best;
  }, [results, optimizationSettings.metric]);

  // Load configs for a strategy whenever it changes
  useEffect(() => {
    if (selectedStrategy) {
      const key = `configs_${selectedStrategy.index}`;
      chrome.storage.local.get([key], (data) => {
        const list = Array.isArray(data[key]) ? data[key] : [];
        setConfigs(list);
      });
      setCurrentConfigName('');
      setNewConfigName('');
    }
  }, [selectedStrategy]);

  // Save a new or overwrite existing configuration
  const saveConfig = () => {
    if (!newConfigName.trim() || !selectedStrategy) return;
    const key = `configs_${selectedStrategy.index}`;
    chrome.storage.local.get([key], (data) => {
      const existing = Array.isArray(data[key]) ? data[key] : [];
      const newConfig = { name: newConfigName.trim(), settings: optimizationSettings };
      const filtered = existing.filter(c => c.name !== newConfig.name);
      const updated = [...filtered, newConfig];
      chrome.storage.local.set({ [key]: updated });
      setConfigs(updated);
      setCurrentConfigName(newConfig.name);
      setNewConfigName('');
    });
  };

  // Load selected configuration into optimization settings
  const loadConfig = (name) => {
    const config = configs.find(c => c.name === name);
    if (config) {
      updateOptimizationSettings(config.settings);
      setCurrentConfigName(name);
    }
  };

  // Delete a configuration
  const deleteConfig = (name) => {
    if (!selectedStrategy) return;
    const key = `configs_${selectedStrategy.index}`;
    const updated = configs.filter(c => c.name !== name);
    chrome.storage.local.set({ [key]: updated });
    setConfigs(updated);
    if (currentConfigName === name) setCurrentConfigName('');
  };

  // Check connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkTradingView' });
      if (response.isValid) {
        setIsConnected(true);
        setConnectionError(null);
      } else {
        setIsConnected(false);
        setConnectionError('Please open a TradingView chart page');
      }
    } catch (error) {
      setIsConnected(false);
      setConnectionError('Failed to connect to TradingView');
    }
  };

  // Calculate setup completion status
  const setupStatus = {
    strategySelected: !!selectedStrategy,
    parametersSet: optimizationSettings.parameters?.some(p => p.enabled) || false,
    ready: !!selectedStrategy && (optimizationSettings.parameters?.some(p => p.enabled) || false)
  };

  if (!isConnected) {
    return (
      <div className="w-96 h-[600px] bg-tv-gray-900 text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-tv-red/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-tv-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2 text-white">TradingView Required</h2>
          <p className="text-sm text-tv-gray-400 mb-6 leading-relaxed">{connectionError}</p>
          <button
            onClick={checkConnection}
            className="px-4 py-2 bg-tv-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            Check Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-96 h-[600px] bg-tv-gray-900 text-white flex flex-col">
      {/* Header with Status */}
      <div className="bg-tv-gray-800 px-4 py-3 border-b border-tv-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Strategy Optimizer</h1>
          <div className="flex items-center gap-2">
            {optimizationState === 'running' && (
              <div className="flex items-center gap-2 text-tv-orange">
                <div className="w-2 h-2 bg-tv-orange rounded-full animate-pulse"></div>
                <span className="text-xs font-medium">Running</span>
              </div>
            )}
            <div className="w-2 h-2 bg-tv-green rounded-full" title="Connected to TradingView"></div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex bg-tv-gray-800 border-b border-tv-gray-700">
        {[
          { id: 'setup', label: 'Setup', icon: '⚙️', disabled: !setupStatus.strategySelected },
          { id: 'optimize', label: 'Optimize', icon: '🚀', disabled: !setupStatus.ready },
          { id: 'results', label: 'Results', icon: '📊', badge: results.length > 0 ? results.length : null }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            disabled={tab.disabled}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors relative ${
              activeView === tab.id
                ? 'text-tv-blue bg-tv-gray-700'
                : tab.disabled
                ? 'text-tv-gray-500 cursor-not-allowed'
                : 'text-tv-gray-300 hover:text-white hover:bg-tv-gray-700/50'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
            {tab.badge && (
              <span className="absolute -top-1 -right-1 bg-tv-blue text-white text-xs rounded-full px-1 min-w-[16px] h-4 flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeView === 'setup' && (
          <div className="p-4 space-y-4">
            {/* Strategy Selection */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${setupStatus.strategySelected ? 'bg-tv-green' : 'bg-tv-gray-600'}`}></div>
                <h3 className="font-medium">Strategy Selection</h3>
              </div>
              <StrategySelector
                strategies={strategies}
                selectedStrategy={selectedStrategy}
                isLoading={isLoadingStrategies}
                onSelectStrategy={(idx) => { selectStrategy(idx); updateOptimizationSettings({ strategyIndex: idx, parameters: [] }); }}
                onRefresh={refreshStrategies}
              />
            </div>

            {/* Configuration Management */}
            {selectedStrategy && (
              <div className="bg-tv-gray-800 rounded p-4 mt-4">
                <h3 className="text-lg font-semibold text-white mb-2">Saved Configurations</h3>
                <div className="flex items-center mb-2">
                  <select
                    value={currentConfigName}
                    onChange={(e) => setCurrentConfigName(e.target.value)}
                    className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
                  >
                    <option value="">Select a config</option>
                    {configs.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => loadConfig(currentConfigName)}
                    disabled={!currentConfigName}
                    className="ml-2 px-3 py-2 bg-tv-blue text-white rounded disabled:opacity-50 cursor-pointer"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => deleteConfig(currentConfigName)}
                    disabled={!currentConfigName}
                    className="ml-2 px-3 py-2 bg-tv-red text-white rounded disabled:opacity-50 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
                <div className="flex items-center">
                  <input
                    type="text"
                    placeholder="New config name"
                    value={newConfigName}
                    onChange={(e) => setNewConfigName(e.target.value)}
                    className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
                  />
                  <button
                    onClick={saveConfig}
                    disabled={!newConfigName.trim()}
                    className="ml-2 px-3 py-2 bg-tv-green text-white rounded disabled:opacity-50 cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Strategy Parameters */}
            {selectedStrategy && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${setupStatus.parametersSet ? 'bg-tv-green' : 'bg-tv-gray-600'}`}></div>
                  <h3 className="font-medium">Strategy Parameters</h3>
                </div>
                <SettingsPanel
                  settings={strategySettings}
                  savedParameters={optimizationSettings.parameters}
                  isLoading={isLoadingSettings}
                  onRefresh={refreshSettings}
                  onUpdateSettings={(settings) => updateOptimizationSettings({ parameters: settings })}
                />
              </div>
            )}

            {/* Quick Start CTA */}
            {setupStatus.ready && (
              <div className="bg-tv-blue/20 border border-tv-blue/50 rounded-lg p-4 text-center">
                <p className="text-sm text-tv-blue mb-3">Setup complete! Ready to optimize.</p>
                <button
                  onClick={() => setActiveView('optimize')}
                  className="px-4 py-2 bg-tv-blue text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                >
                  Continue to Optimization →
                </button>
              </div>
            )}
          </div>
        )}

        {activeView === 'optimize' && (
          <div className="p-4 space-y-4">
            <OptimizationPanel
              settings={optimizationSettings}
              state={optimizationState}
              progress={progress}
              onUpdateSettings={updateOptimizationSettings}
              onStart={() => { startOptimization(); setActiveView('results'); }}
              onStop={stopOptimization}
            />
            <FiltersPanel
              filters={filters}
              onAddFilter={addFilter}
              onRemoveFilter={removeFilter}
            />
          </div>
        )}

        {activeView === 'results' && (
          <div className="p-4 space-y-4">
            <ResultsPanel
              results={results}
              bestResult={bestResult}
              parameters={optimizationSettings.parameters}
              onClear={clearResults}
              isOptimizing={optimizationState === 'running'}
            />
            <LogsPanel logs={logs} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App; 