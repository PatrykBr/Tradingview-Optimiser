import React, { useState, useEffect } from 'react';
import { getAvailableMetrics } from '../utils/metrics';

function FiltersPanel({ filters, onAddFilter, onRemoveFilter }) {
  const [newFilter, setNewFilter] = useState({
    metric: 'maxDrawdown',
    min: '',
    max: ''
  });

  const availableMetrics = getAvailableMetrics();

  // Favorites state for metrics
  const [favoriteMetrics, setFavoriteMetrics] = useState([]);
  // Load favorite metrics from storage
  useEffect(() => {
    chrome.storage.local.get('favoriteMetrics', (data) => {
      if (Array.isArray(data.favoriteMetrics)) {
        setFavoriteMetrics(data.favoriteMetrics);
      }
    });
  }, []);
  // Sort metrics: favorites first
  const sortedMetrics = [
    ...availableMetrics.filter(m => favoriteMetrics.includes(m.key)),
    ...availableMetrics.filter(m => !favoriteMetrics.includes(m.key))
  ];
  // Toggle favorite for selected filter metric
  const toggleFavoriteForFilter = () => {
    const key = newFilter.metric;
    const newFavs = favoriteMetrics.includes(key)
      ? favoriteMetrics.filter(k => k !== key)
      : [...favoriteMetrics, key];
    setFavoriteMetrics(newFavs);
    chrome.storage.local.set({ favoriteMetrics: newFavs });
  };

  const handleAddFilter = () => {
    if (newFilter.metric && (newFilter.min !== '' || newFilter.max !== '')) {
      onAddFilter({
        ...newFilter,
        min: newFilter.min === '' ? null : parseFloat(newFilter.min),
        max: newFilter.max === '' ? null : parseFloat(newFilter.max),
        id: Date.now() // Simple ID generation
      });
      
      // Reset form
      setNewFilter({
        metric: 'maxDrawdown',
        min: '',
        max: ''
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-tv-gray-800 rounded p-4">
        <h3 className="text-lg font-semibold mb-4">Add Filter</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tv-gray-300 mb-1">
              Filter Metric
            </label>
            <div className="flex items-center">
              <select
                value={newFilter.metric}
                onChange={(e) => setNewFilter({ ...newFilter, metric: e.target.value })}
                className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
              >
                {sortedMetrics.map(metric => (
                  <option key={metric.key} value={metric.key}>
                    {favoriteMetrics.includes(metric.key) ? '★ ' : ''}{metric.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleFavoriteForFilter}
                className="ml-2 text-tv-orange"
                title={favoriteMetrics.includes(newFilter.metric) ? 'Remove from favorites' : 'Add to favorites'}
              >
                {favoriteMetrics.includes(newFilter.metric) ? '★' : '☆'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tv-gray-300 mb-1">
                Min Value (optional)
              </label>
              <input
                type="number"
                value={newFilter.min}
                onChange={(e) => setNewFilter({ ...newFilter, min: e.target.value })}
                placeholder="No minimum"
                step="any"
                className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue placeholder-tv-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tv-gray-300 mb-1">
                Max Value (optional)
              </label>
              <input
                type="number"
                value={newFilter.max}
                onChange={(e) => setNewFilter({ ...newFilter, max: e.target.value })}
                placeholder="No maximum"
                step="any"
                className="w-full bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue placeholder-tv-gray-500"
              />
            </div>
          </div>

          <button
            onClick={handleAddFilter}
            disabled={!newFilter.metric || (newFilter.min === '' && newFilter.max === '')}
            className="w-full px-4 py-2 bg-tv-blue text-white font-medium rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Filter
          </button>
        </div>
      </div>

      <div className="bg-tv-gray-800 rounded p-4">
        <h3 className="text-lg font-semibold mb-4">Active Filters</h3>
        
        {filters.length === 0 ? (
          <p className="text-tv-gray-400 text-center py-4">No filters applied</p>
        ) : (
          <div className="space-y-2">
            {filters.map(filter => {
              const metric = availableMetrics.find(m => m.key === filter.metric);
              return (
                <div key={filter.id} className="flex items-center justify-between p-3 bg-tv-gray-700 rounded">
                  <div>
                    <span className="font-medium">{metric?.name || filter.metric}</span>
                    <span className="text-sm text-tv-gray-400 ml-2">
                      {filter.min !== null && filter.max !== null
                        ? `${filter.min} - ${filter.max}`
                        : filter.min !== null
                        ? `≥ ${filter.min}`
                        : `≤ ${filter.max}`}
                    </span>
                  </div>
                  <button
                    onClick={() => onRemoveFilter(filter.id)}
                    className="text-tv-red hover:text-red-400 transition-colors"
                    title="Remove filter"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default FiltersPanel; 