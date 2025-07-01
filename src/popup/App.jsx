import React, { useState, useEffect, useMemo } from 'react';
import StrategySelector from '../components/StrategySelector';
import SettingsPanel from '../components/SettingsPanel';
import OptimizationPanel from '../components/OptimizationPanel';
import FiltersPanel from '../components/FiltersPanel';
import ResultsPanel from '../components/ResultsPanel';
import LogsPanel from '../components/LogsPanel';
import ConfigManager from '../components/ConfigManager';
import LoadingScreen from '../components/LoadingScreen';
import ErrorScreen from '../components/ErrorScreen';
import { useOptimization } from '../hooks/useOptimization';
import { useTradingView } from '../hooks/useTradingView';

function App() {
  const [activeView, setActiveView] = useState('setup');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const {
    strategies,
    selectedStrategy,
    strategySettings,
    isLoadingStrategies,
    isLoadingSettings,
    error: tradingViewError,
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
    clearResults,
    applyBestResult,
    exportToCSV,
    exportToJSON,
    isStateLoaded
  } = useOptimization();

  // Calculate best result dynamically
  const bestResult = useMemo(() => {
    if (results.length === 0) return null;
    
    const validResults = results.filter(r => r.isValid);
    if (validResults.length === 0) return null;
    
    const isMaximizeMetric = ['netProfit', 'grossProfit', 'profitFactor', 'sharpeRatio'].includes(optimizationSettings.metric);
    
    return validResults.reduce((best, result) => {
      const isBetter = isMaximizeMetric ? result.value > best.value : result.value < best.value;
      return isBetter ? result : best;
    }, validResults[0]);
  }, [results, optimizationSettings.metric]);

  // Auto-switch to appropriate view when state is loaded (only once)
  useEffect(() => {
    if (!isStateLoaded) return;
    
    // Only auto-switch once when state is first loaded
    // If optimization is running, switch to optimize tab
    if (optimizationState === 'running') {
      setActiveView('optimize');
    }
    // If there are results and no ongoing optimization, switch to results tab
    else if (results.length > 0 && optimizationState === 'idle') {
      setActiveView('results');
    }
  }, [isStateLoaded]); // Only depend on isStateLoaded to avoid switching during iterations

  // Listen for config load events from ConfigManager
  useEffect(() => {
    const handleLoadConfig = (event) => {
      updateOptimizationSettings(event.detail);
    };
    window.addEventListener('loadConfig', handleLoadConfig);
    return () => window.removeEventListener('loadConfig', handleLoadConfig);
  }, [updateOptimizationSettings]);

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
  // When state is restored, we might have optimization settings even if selectedStrategy isn't loaded yet
  const hasRestoredParameters = optimizationSettings.parameters?.length > 0;
  const hasEnabledParameters = optimizationSettings.parameters?.some(p => p.enabled) || false;
  
  const setupStatus = {
    strategySelected: !!selectedStrategy || hasRestoredParameters,
    parametersSet: hasEnabledParameters,
    ready: (!!selectedStrategy || hasRestoredParameters) && hasEnabledParameters
  };

  const handleApplyCurrentValues = async (settings) => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'forwardToContent',
        data: {
          action: 'applySettings',
          strategyIndex: selectedStrategy?.index || optimizationSettings.strategyIndex || 0,
          settings: settings
        }
      });
      
      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to apply settings');
      }
    } catch (error) {
      console.error('Failed to apply current values:', error);
      throw error;
    }
  };

  // Show loading screen while state is being restored
  if (!isStateLoaded) {
    return <LoadingScreen />;
  }

  if (!isConnected) {
    return <ErrorScreen 
      title="TradingView Required" 
      message={connectionError} 
      onRetry={checkConnection} 
    />;
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
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex bg-tv-gray-800 border-b border-tv-gray-700">
        {[
          { 
            id: 'setup', 
            label: 'Setup', 
            icon: '⚙️', 
            disabled: !setupStatus.strategySelected && optimizationState === 'idle' && results.length === 0
          },
          { 
            id: 'optimize', 
            label: 'Optimize', 
            icon: '🚀', 
            disabled: !setupStatus.ready && optimizationState === 'idle' && results.length === 0
          },
          { 
            id: 'results', 
            label: 'Results', 
            icon: '📊', 
            badge: results.length > 0 ? results.length : null 
          }
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
              
              {/* Show error message if TradingView is not ready */}
              {tradingViewError && (
                <div className="bg-red-900/20 border border-red-600/50 rounded-lg p-3 text-sm text-red-400">
                  <p>{tradingViewError}</p>
                  <button
                    onClick={refreshStrategies}
                    className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
                  >
                    Try again
                  </button>
                </div>
              )}
              
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
              <ConfigManager 
                selectedStrategy={selectedStrategy} 
                optimizationSettings={optimizationSettings} 
              />
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
                  onApplyCurrentValues={handleApplyCurrentValues}
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
              onApplyBest={() => applyBestResult(bestResult)}
              onExportCSV={exportToCSV}
              onExportJSON={exportToJSON}
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