import React from 'react';
import { getAvailableMetrics } from '../utils/metrics';

function ResultsPanel({ results, bestResult, parameters = [], onClear, onApplyBest, onExportCSV, onExportJSON, isOptimizing = false }) {
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

  // Helper function to render parameter settings with fallback
  const renderParameterSettings = (resultSettings) => {
    if (!resultSettings) {
      return <div className="text-tv-gray-400">No settings available</div>;
    }
    
    const settingsEntries = Object.entries(resultSettings);
    if (settingsEntries.length === 0) {
      return <div className="text-tv-gray-400">Settings object is empty</div>;
    }
    
    // If we have parameter definitions, use them for filtering and display
    if (parameters && parameters.length > 0) {
      // Only filter by enabled parameters that have matching settings
      const enabledParams = parameters.filter(p => p.enabled);
      const filteredParams = enabledParams.filter(p => resultSettings.hasOwnProperty(p.name));
      
      if (filteredParams.length > 0) {
        return filteredParams.map(p => (
          <div key={p.name} className="flex justify-between">
            <span className="text-tv-gray-300 truncate">{p.name}</span>
            <span className="text-white font-medium">{String(resultSettings[p.name])}</span>
          </div>
        ));
      }
    }
    
    // Fallback: display all available settings from the result
    return settingsEntries.map(([key, value]) => (
      <div key={key} className="flex justify-between">
        <span className="text-tv-gray-300 truncate">{key}</span>
        <span className="text-white font-medium">{String(value)}</span>
      </div>
    ));
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
          <div className="w-2 h-2 bg-tv-orange rounded-full animate-pulse"></div>
          <span className="text-xs text-tv-orange font-medium bg-tv-gray-800 px-2 py-1 rounded">Optimization in progress...</span>
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
          </div>
          <details className="bg-tv-gray-800 rounded-lg p-3 text-xs">
            <summary className="cursor-pointer text-tv-blue hover:text-blue-400">View Parameters</summary>
            <div className="mt-2 space-y-1 font-mono">
              {renderParameterSettings(bestResult.settings)}
            </div>
          </details>
        </div>
      )}

      {/* Action Buttons - Show when optimization is finished and there are results */}
      {!isOptimizing && results.length > 0 && (
        <div className="bg-tv-gray-800 rounded-lg p-4">
          <h3 className="text-base font-semibold text-white mb-3">Actions</h3>
          <div className="flex flex-wrap gap-3">
            {bestResult && (
              <button
                onClick={onApplyBest}
                className="flex items-center space-x-2 px-4 py-2 bg-tv-green text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Apply Best</span>
              </button>
            )}
            <button
              onClick={onExportCSV}
              className="flex items-center space-x-2 px-4 py-2 bg-tv-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Export CSV</span>
            </button>
            <button
              onClick={onExportJSON}
              className="flex items-center space-x-2 px-4 py-2 bg-tv-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Export JSON</span>
            </button>
          </div>
        </div>
      )}

      <div className="bg-tv-gray-800 rounded p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold">All Results</h3>
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
                          {renderParameterSettings(result.settings)}
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