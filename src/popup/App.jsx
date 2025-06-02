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
  const [activeTab, setActiveTab] = useState('settings');
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

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-tv-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-tv-red text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
          <p className="text-tv-gray-400 mb-4">{connectionError}</p>
          <button
            onClick={checkConnection}
            className="px-4 py-2 bg-tv-blue text-white rounded hover:bg-blue-600 transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tv-gray-900 text-white">
      <Header />
      
      <div className="p-4">
        <StrategySelector
          strategies={strategies}
          selectedStrategy={selectedStrategy}
          isLoading={isLoadingStrategies}
          onSelectStrategy={selectStrategy}
          onRefresh={refreshStrategies}
        />

        <div className="mt-4">
          <div className="flex space-x-1 border-b border-tv-gray-700">
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'text-tv-blue border-b-2 border-tv-blue'
                  : 'text-tv-gray-400 hover:text-white'
              }`}
            >
              Settings
            </button>
            <button
              onClick={() => setActiveTab('optimization')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'optimization'
                  ? 'text-tv-blue border-b-2 border-tv-blue'
                  : 'text-tv-gray-400 hover:text-white'
              }`}
            >
              Optimization
            </button>
            <button
              onClick={() => setActiveTab('filters')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'filters'
                  ? 'text-tv-blue border-b-2 border-tv-blue'
                  : 'text-tv-gray-400 hover:text-white'
              }`}
            >
              Filters
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'results'
                  ? 'text-tv-blue border-b-2 border-tv-blue'
                  : 'text-tv-gray-400 hover:text-white'
              }`}
            >
              Results
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'logs'
                  ? 'text-tv-blue border-b-2 border-tv-blue'
                  : 'text-tv-gray-400 hover:text-white'
              }`}
            >
              Logs
            </button>
          </div>

          <div className="mt-4">
            {activeTab === 'settings' && (
              <SettingsPanel
                settings={strategySettings}
                isLoading={isLoadingSettings}
                onRefresh={refreshSettings}
                onUpdateSettings={(settings) => updateOptimizationSettings({ parameters: settings })}
              />
            )}
            
            {activeTab === 'optimization' && (
              <OptimizationPanel
                settings={optimizationSettings}
                state={optimizationState}
                progress={progress}
                onUpdateSettings={updateOptimizationSettings}
                onStart={startOptimization}
                onStop={stopOptimization}
              />
            )}
            
            {activeTab === 'filters' && (
              <FiltersPanel
                filters={filters}
                onAddFilter={addFilter}
                onRemoveFilter={removeFilter}
              />
            )}
            
            {activeTab === 'results' && (
              <ResultsPanel
                results={results}
                bestResult={results.find(r => r.isBest)}
                onClear={clearResults}
              />
            )}
            
            {activeTab === 'logs' && (
              <LogsPanel logs={logs} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App; 