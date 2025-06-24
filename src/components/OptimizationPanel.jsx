import React, { useState, useEffect } from 'react';
import { getAvailableMetrics } from '../utils/metrics';

function OptimizationPanel({ settings, state, progress, onUpdateSettings, onStart, onStop }) {
  const [localSettings, setLocalSettings] = useState({
    metric: 'netProfit',
    iterations: 50,
    deepBacktest: false,
    startDate: '',
    endDate: '',
    antiDetection: {
      minDelay: 500,
      maxDelay: 2000
    }
  });

  const availableMetrics = getAvailableMetrics();
  const [favoriteMetrics, setFavoriteMetrics] = useState([]);

  useEffect(() => {
    if (settings) {
      setLocalSettings({ ...localSettings, ...settings });
    }
  }, [settings]);

  useEffect(() => {
    chrome.storage.local.get('favoriteMetrics', (data) => {
      if (Array.isArray(data.favoriteMetrics)) {
        setFavoriteMetrics(data.favoriteMetrics);
      }
    });
  }, []);

  // Listen to storage changes for favoriteMetrics
  useEffect(() => {
    const handleStorageChange = (changes, area) => {
      if (area === 'local' && changes.favoriteMetrics) {
        const newFavs = changes.favoriteMetrics.newValue;
        if (Array.isArray(newFavs)) setFavoriteMetrics(newFavs);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const sortedMetrics = [
    ...availableMetrics.filter(m => favoriteMetrics.includes(m.key)),
    ...availableMetrics.filter(m => !favoriteMetrics.includes(m.key))
  ];

  const toggleFavorite = () => {
    const key = localSettings.metric;
    const newFavs = favoriteMetrics.includes(key)
      ? favoriteMetrics.filter(k => k !== key)
      : [...favoriteMetrics, key];
    setFavoriteMetrics(newFavs);
    chrome.storage.local.set({ favoriteMetrics: newFavs });
  };

  const handleChange = (field, value) => {
    let updated = { ...localSettings, [field]: value };
    // When enabling deep backtest, default dates to last year through today
    if (field === 'deepBacktest' && value) {
      const today = new Date();
      const endDateStr = today.toISOString().slice(0, 10);
      const startDate = new Date();
      startDate.setFullYear(today.getFullYear() - 1);
      const startDateStr = startDate.toISOString().slice(0, 10);
      updated.startDate = startDateStr;
      updated.endDate = endDateStr;
    }
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  const handleAntiDetectionChange = (field, value) => {
    const updated = {
      ...localSettings,
      antiDetection: {
        ...localSettings.antiDetection,
        [field]: parseInt(value) || 0
      }
    };
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  const calculateMaxCombinations = () => {
    if (!settings?.parameters) return 0;
    
    let combinations = 1;
    settings.parameters.forEach(param => {
      if (!param.enabled) return;
      
      if (param.type === 'number') {
        const range = param.max - param.min;
        const isFloat = param.min % 1 !== 0 || param.max % 1 !== 0;
        const step = isFloat ? 0.01 : 1;
        combinations *= Math.floor(range / step) + 1;
      } else if (param.type === 'checkbox') {
        combinations *= 2;
      } else if (param.type === 'select' && param.options) {
        combinations *= param.options.length;
      }
    });
    
    return combinations;
  };

  const maxCombinations = calculateMaxCombinations();
  const isRunning = state === 'running';

  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      {state === 'running' && (
        <div className="bg-tv-orange/20 border border-tv-orange/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-tv-orange">Optimization Running</span>
            <span className="text-xs text-tv-orange">{progress.current}/{progress.total}</span>
          </div>
          <div className="w-full bg-tv-gray-700 h-2 rounded-full overflow-hidden">
            <div
              className="bg-tv-orange h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Optimization Method Info */}
      <div className="bg-tv-blue/10 border border-tv-blue/30 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 bg-tv-blue rounded-full"></div>
          <span className="text-sm font-medium text-tv-blue">Bayesian Optimization</span>
        </div>
        <p className="text-xs text-tv-gray-300">
          First tests current settings as baseline, then uses Latin Hypercube Sampling (LHS) for initial exploration, 
          followed by Bayesian optimization for intelligent parameter space exploration. This method converges faster 
          and finds better solutions than random search.
        </p>
      </div>

      <div className="bg-tv-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Optimization Settings</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-tv-gray-300 mb-2">
              Optimization Metric
            </label>
            <div className="flex items-center">
              <select
                value={localSettings.metric}
                onChange={(e) => handleChange('metric', e.target.value)}
                disabled={isRunning}
                className="flex-1 bg-tv-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
              >
                {sortedMetrics.map(metric => (
                  <option
                    key={metric.key}
                    value={metric.key}
                    className={favoriteMetrics.includes(metric.key) ? 'text-tv-orange' : ''}
                  >
                    {favoriteMetrics.includes(metric.key) ? '⭐ ' : ''}{metric.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleFavorite}
                disabled={isRunning}
                className="ml-2 p-1 rounded-full hover:bg-tv-gray-700 disabled:opacity-50 cursor-pointer"
                title={favoriteMetrics.includes(localSettings.metric) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg
                  className={`${favoriteMetrics.includes(localSettings.metric) ? 'text-tv-orange' : 'text-tv-gray-500 hover:text-tv-orange'} w-5 h-5 transition-colors`}
                  fill={favoriteMetrics.includes(localSettings.metric) ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-tv-gray-300 mb-2">
              Number of Iterations
            </label>
            <input
              type="number"
              value={localSettings.iterations}
              onChange={(e) => handleChange('iterations', parseInt(e.target.value) || 0)}
              min="1"
              max={maxCombinations}
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
            />
            <div className="mt-2 space-y-1">
              <p className="text-xs text-tv-gray-400">
                Max possible combinations: {maxCombinations}
              </p>
              <p className="text-xs text-tv-blue">
                💡 Recommended: 100-200 iterations for better convergence and more valid results
              </p>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={localSettings.deepBacktest}
                onChange={(e) => handleChange('deepBacktest', e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 text-tv-blue bg-tv-gray-700 border-tv-gray-600 rounded focus:ring-tv-blue focus:ring-1 disabled:opacity-50"
              />
              <span className="text-xs font-medium text-tv-gray-300">Enable Deep Backtesting</span>
            </label>
          </div>

          {localSettings.deepBacktest && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div>
                <label className="block text-xs font-medium text-tv-gray-300 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={localSettings.startDate}
                  onChange={(e) => handleChange('startDate', e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-tv-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-tv-gray-300 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={localSettings.endDate}
                  onChange={(e) => handleChange('endDate', e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-tv-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-tv-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Anti-Detection</h3>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-tv-gray-300 mb-1">
              Min Delay (ms)
            </label>
            <input
              type="number"
              value={localSettings.antiDetection.minDelay}
              onChange={(e) => handleAntiDetectionChange('minDelay', e.target.value)}
              min="0"
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-tv-gray-300 mb-1">
              Max Delay (ms)
            </label>
            <input
              type="number"
              value={localSettings.antiDetection.maxDelay}
              onChange={(e) => handleAntiDetectionChange('maxDelay', e.target.value)}
              min="0"
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {!isRunning ? (
          <button
            onClick={onStart}
            disabled={!settings?.parameters?.some(p => p.enabled) || localSettings.iterations === 0}
            className="flex-1 px-4 py-3 bg-tv-green text-white font-medium rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            🚀 Start Optimization
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex-1 px-4 py-3 bg-tv-red text-white font-medium rounded-lg hover:bg-red-600 transition-colors text-sm"
          >
            ⏹️ Stop Optimization
          </button>
        )}
      </div>
    </div>
  );
}

export default OptimizationPanel; 