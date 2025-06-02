import React from 'react';
import { getAvailableMetrics } from '../utils/metrics';

function ResultsPanel({ results, bestResult, onClear }) {
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

  return (
    <div className="space-y-4">
      {bestResult && (
        <div className="bg-tv-green bg-opacity-20 border border-tv-green rounded p-4">
          <h3 className="text-lg font-semibold text-tv-green mb-2">Best Result So Far</h3>
          <div className="space-y-2">
            <div>
              <span className="text-sm text-tv-gray-400">Metric Value:</span>
              <span className="ml-2 font-medium">{formatValue(bestResult.value, bestResult.metric)}</span>
            </div>
            <div>
              <span className="text-sm text-tv-gray-400">Settings:</span>
              <div className="mt-1 text-sm bg-tv-gray-800 rounded p-2 font-mono">
                {formatSettings(bestResult.settings)}
              </div>
            </div>
            <div>
              <span className="text-sm text-tv-gray-400">Iteration:</span>
              <span className="ml-2">{bestResult.iteration}</span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-tv-gray-800 rounded p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">All Results</h3>
          <button
            onClick={onClear}
            disabled={results.length === 0}
            className="text-sm text-tv-red hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear Results
          </button>
        </div>

        {results.length === 0 ? (
          <p className="text-tv-gray-400 text-center py-8">No results yet. Start an optimization to see results.</p>
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
                          ? 'bg-tv-green bg-opacity-20 text-tv-green' 
                          : 'bg-tv-red bg-opacity-20 text-tv-red'
                      }`}>
                        {result.isValid ? 'Valid' : 'Filtered'}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <details className="cursor-pointer">
                        <summary className="text-tv-blue hover:text-blue-400">View</summary>
                        <div className="mt-1 text-xs bg-tv-gray-700 rounded p-2 font-mono">
                          {formatSettings(result.settings)}
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