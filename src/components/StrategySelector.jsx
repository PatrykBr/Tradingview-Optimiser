import React from 'react';

function StrategySelector({ strategies, selectedStrategy, isLoading, onSelectStrategy, onRefresh }) {
  return (
    <div className="bg-tv-gray-800 rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Strategy Selection</h2>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="text-tv-blue hover:text-blue-400 transition-colors disabled:opacity-50"
          title="Refresh strategies"
        >
          <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      
      {isLoading ? (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-tv-blue"></div>
          <p className="text-sm text-tv-gray-400 mt-2">Detecting strategies...</p>
        </div>
      ) : strategies.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-tv-gray-400">No strategies detected on the chart</p>
          <button
            onClick={onRefresh}
            className="mt-2 text-sm text-tv-blue hover:text-blue-400"
          >
            Try again
          </button>
        </div>
      ) : (
        <select
          value={selectedStrategy?.index ?? ''}
          onChange={(e) => onSelectStrategy(parseInt(e.target.value))}
          className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
        >
          <option value="" disabled>Select a strategy</option>
          {strategies.map((strategy) => (
            <option key={strategy.index} value={strategy.index}>
              {strategy.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default StrategySelector; 