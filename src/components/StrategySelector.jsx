import React from 'react';

function StrategySelector({ strategies, selectedStrategy, isLoading, onSelectStrategy, onRefresh }) {
  if (isLoading) {
    return (
      <div className="bg-tv-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-tv-blue border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-tv-gray-300">Detecting strategies...</span>
        </div>
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="bg-tv-gray-800 rounded-lg p-4 text-center">
        <div className="text-tv-gray-400 mb-3">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-sm">No strategies found on chart</p>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-2 bg-tv-blue text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
        >
          Scan Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-tv-gray-800 rounded-lg p-4">
      <div className="flex gap-2">
        <select
          value={selectedStrategy?.index ?? ''}
          onChange={(e) => onSelectStrategy(parseInt(e.target.value))}
          className="flex-1 bg-tv-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue"
        >
          <option value="" disabled>Choose strategy</option>
          {strategies.map((strategy) => (
            <option key={strategy.index} value={strategy.index}>
              {strategy.name}
            </option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-3 py-2 bg-tv-gray-700 text-tv-gray-300 rounded-lg hover:bg-tv-gray-600 hover:text-white transition-colors disabled:opacity-50"
          title="Refresh strategies"
        >
          <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      {selectedStrategy && (
        <div className="mt-3 p-2 bg-tv-gray-700 rounded text-sm">
          <span className="text-tv-gray-400">Selected:</span>
          <span className="text-white font-medium ml-2">{selectedStrategy.name}</span>
        </div>
      )}
    </div>
  );
}

export default StrategySelector; 