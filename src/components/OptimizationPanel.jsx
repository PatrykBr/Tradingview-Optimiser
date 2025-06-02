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
    <div className="space-y-4">
      {/* Progress Bar */}
      {state === 'running' && (
        <div className="bg-tv-gray-800 rounded p-4">
          <div className="text-sm text-tv-gray-300 mb-2">
            Progress: {progress.current}/{progress.total}
          </div>
          <div className="w-full bg-tv-gray-700 h-2 rounded">
            <div
              className="bg-tv-blue h-2 rounded"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      <div className="bg-tv-gray-800 rounded p-4">
        <h3 className="text-lg font-semibold mb-4">Optimization Settings</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tv-gray-300 mb-1">
              Optimization Metric
            </label>
            <div className="flex items-center">
              <select
                value={localSettings.metric}
                onChange={(e) => handleChange('metric', e.target.value)}
                disabled={isRunning}
                className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
              >
                {sortedMetrics.map(metric => (
                  <option key={metric.key} value={metric.key}>
                    {favoriteMetrics.includes(metric.key) ? '★ ' : ''}{metric.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleFavorite}
                disabled={isRunning}
                className="ml-2 text-tv-orange"
                title={favoriteMetrics.includes(localSettings.metric) ? 'Remove from favorites' : 'Add to favorites'}
              >
                {favoriteMetrics.includes(localSettings.metric) ? '★' : '☆'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-tv-gray-300 mb-1">
              Number of Iterations
            </label>
            <input
              type="number"
              value={localSettings.iterations}
              onChange={(e) => handleChange('iterations', parseInt(e.target.value) || 0)}
              min="1"
              max={maxCombinations}
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
            />
            <p className="text-xs text-tv-gray-400 mt-1">
              Max possible combinations: {maxCombinations}
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={localSettings.deepBacktest}
                onChange={(e) => handleChange('deepBacktest', e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 text-tv-blue bg-tv-gray-700 border-tv-gray-600 rounded focus:ring-tv-blue focus:ring-2 disabled:opacity-50"
              />
              <span className="text-sm font-medium text-tv-gray-300">Enable Deep Backtesting</span>
            </label>
          </div>

          {localSettings.deepBacktest && (
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div>
                <label className="block text-sm font-medium text-tv-gray-300 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={localSettings.startDate}
                  onChange={(e) => handleChange('startDate', e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-tv-gray-300 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={localSettings.endDate}
                  onChange={(e) => handleChange('endDate', e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-tv-gray-800 rounded p-4">
        <h3 className="text-lg font-semibold mb-4">Anti-Detection Settings</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-tv-gray-300 mb-1">
              Min Delay (ms)
            </label>
            <input
              type="number"
              value={localSettings.antiDetection.minDelay}
              onChange={(e) => handleAntiDetectionChange('minDelay', e.target.value)}
              min="0"
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tv-gray-300 mb-1">
              Max Delay (ms)
            </label>
            <input
              type="number"
              value={localSettings.antiDetection.maxDelay}
              onChange={(e) => handleAntiDetectionChange('maxDelay', e.target.value)}
              min="0"
              disabled={isRunning}
              className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        {!isRunning ? (
          <button
            onClick={onStart}
            disabled={!settings?.parameters?.some(p => p.enabled) || localSettings.iterations === 0}
            className="px-6 py-3 bg-tv-green text-white font-medium rounded hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Optimization
          </button>
        ) : (
          <button
            onClick={onStop}
            className="px-6 py-3 bg-tv-red text-white font-medium rounded hover:bg-red-600 transition-colors"
          >
            Stop Optimization
          </button>
        )}
      </div>
    </div>
  );
}

export default OptimizationPanel; 