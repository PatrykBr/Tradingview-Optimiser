import React from 'react';
import { getAvailableMetrics } from '../utils/metrics';

function ResultsPanel({ results, bestResult, parameters = [], onClear, isOptimizing = false }) {
  const metrics = getAvailableMetrics();

  const formatValue = (value, metricKey) => {
    if (value === null || value === undefined) return 'N/A';
    
    const metric = metrics.find(m => m.key === metricKey);
    if (metric?.format === 'percentage') {
      return `${value.toFixed(2)}%`;
    } else if (metric?.format === 'currency') {
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      return value.toFixed(2);
    }
  };

  const formatSettings = (settings) => {
    return Object.entries(settings)
      .map(([key, value]) => {
        if (typeof value === 'boolean') {
          return `${key}: ${value ? 'On' : 'Off'}`;
        }
        return `${key}: ${value}`;
      })
      .join(', ');
  };

  // Determine the title and styling based on optimization state
  const getBestResultTitle = () => {
    if (isOptimizing) {
      return "Best Result So Far";
    } else {
      return bestResult ? "Final Best Result" : "Best Result";
    }
  };

  const getBestResultIndicator = () => {
    if (isOptimizing && bestResult) {
      return (
        <div className="flex items-center space-x-2 mb-2">
          <div className="w-2 h-2 bg-tv-blue rounded-full animate-pulse"></div>
          <span className="text-xs text-tv-blue font-medium">Optimization in progress...</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {bestResult && (
        <div className={`${isOptimizing ? 'bg-tv-blue bg-opacity-20 border-tv-blue' : 'bg-tv-green bg-opacity-20 border-tv-green'} border rounded-lg p-4 text-white`}>
          {getBestResultIndicator()}
          <h3 className="text-base font-semibold text-white mb-3">{getBestResultTitle()}</h3>
          <div className="flex items-center space-x-6 mb-3">
            <div>
              <p className="text-xs text-tv-gray-300 uppercase">Metric</p>
              <p className="text-2xl font-bold">{formatValue(bestResult.value, bestResult.metric)}</p>
            </div>
            <div>
              <p className="text-xs text-tv-gray-300 uppercase">Iteration</p>
              <p className="text-lg font-medium">{bestResult.iteration}</p>
            </div>
            {isOptimizing && (
              <div>
                <p className="text-xs text-tv-gray-300 uppercase">Status</p>
                <p className="text-lg font-medium text-tv-blue">Running</p>
              </div>
            )}
          </div>
          <details className="bg-tv-gray-800 rounded-lg p-3 text-xs">
            <summary className="cursor-pointer text-tv-blue hover:text-blue-400">View Parameters</summary>
            <div className="mt-2 space-y-1 font-mono">
              {parameters
                .filter(p => bestResult.settings.hasOwnProperty(p.name))
                .map(p => (
                  <div key={p.name} className="flex justify-between">
                    <span className="text-tv-gray-300 truncate">{p.name}</span>
                    <span className="text-white font-medium">{String(bestResult.settings[p.name])}</span>
                  </div>
                ))}
            </div>
          </details>
        </div>
      )}

      <div className="bg-tv-gray-800 rounded p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold">All Results</h3>
            {isOptimizing && (
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-tv-blue rounded-full animate-pulse"></div>
                <span className="text-xs text-tv-blue">Live Updates</span>
              </div>
            )}
          </div>
          <button
            onClick={onClear}
            disabled={results.length === 0 || isOptimizing}
            className="text-sm text-tv-red hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear Results
          </button>
        </div>

        {results.length === 0 ? (
          <p className="text-tv-gray-400 text-center py-8">
            {isOptimizing ? "Optimization starting..." : "No results yet. Start an optimization to see results."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tv-gray-700">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Metric Value</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Settings</th>
                </tr>
              </thead>
              <tbody>
                {results.slice().reverse().map((result, index) => (
                  <tr 
                    key={result.iteration} 
                    className={`border-b border-tv-gray-700 ${result.isBest ? 'bg-tv-green bg-opacity-10' : ''}`}
                  >
                    <td className="py-2 px-2">{result.iteration}</td>
                    <td className="py-2 px-2 font-medium">
                      {formatValue(result.value, result.metric)}
                    </td>
                    <td className="py-2 px-2">
                      <span className={`inline-block px-2 py-1 text-xs rounded ${
                        result.isValid 
                          ? 'bg-tv-green bg-opacity-20 text-white' 
                          : 'bg-tv-red bg-opacity-20 text-white'
                      }`}>
                        {result.isValid ? 'Valid' : 'Filtered'}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <details className="bg-tv-gray-800 rounded-lg p-2 text-xs">
                        <summary className="cursor-pointer text-tv-blue hover:text-blue-400">View</summary>
                        <div className="mt-2 space-y-1 font-mono">
                          {parameters
                            .filter(p => result.settings.hasOwnProperty(p.name))
                            .map(p => (
                              <div key={p.name} className="flex justify-between">
                                <span className="text-tv-gray-300 truncate">{p.name}</span>
                                <span className="text-white font-medium">{String(result.settings[p.name])}</span>
                              </div>
                            ))}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultsPanel; 