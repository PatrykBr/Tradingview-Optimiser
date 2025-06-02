import React, { useState, useEffect } from 'react';

function SettingsPanel({ settings, isLoading, onRefresh, onUpdateSettings }) {
  const [localSettings, setLocalSettings] = useState([]);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings.map(setting => ({
        ...setting,
        enabled: false,
        min: setting.type === 'number' ? parseFloat(setting.value) : undefined,
        max: setting.type === 'number' ? parseFloat(setting.value) : undefined
      })));
    }
  }, [settings]);

  const handleToggleSetting = (index) => {
    const updated = [...localSettings];
    updated[index].enabled = !updated[index].enabled;
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  const handleMinMaxChange = (index, field, value) => {
    const updated = [...localSettings];
    updated[index][field] = value === '' ? '' : parseFloat(value);
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  if (isLoading) {
    return (
      <div className="bg-tv-gray-800 rounded p-4">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-tv-blue"></div>
          <p className="text-sm text-tv-gray-400 mt-2">Reading strategy settings...</p>
        </div>
      </div>
    );
  }

  if (!settings || settings.length === 0) {
    return (
      <div className="bg-tv-gray-800 rounded p-4">
        <div className="text-center py-8">
          <p className="text-tv-gray-400">No settings available</p>
          <button
            onClick={onRefresh}
            className="mt-2 text-sm text-tv-blue hover:text-blue-400"
          >
            Refresh settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-tv-gray-800 rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Strategy Settings</h3>
        <button
          onClick={onRefresh}
          className="text-tv-blue hover:text-blue-400 transition-colors"
          title="Refresh settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {localSettings.map((setting, index) => (
          <div key={index} className="border border-tv-gray-700 rounded p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={setting.enabled}
                onChange={() => handleToggleSetting(index)}
                className="mt-1 w-4 h-4 text-tv-blue bg-tv-gray-700 border-tv-gray-600 rounded focus:ring-tv-blue focus:ring-2"
              />
              
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-medium text-white">{setting.name}</label>
                  <span className="text-sm text-tv-gray-400">
                    Current: {setting.type === 'checkbox' ? (setting.value ? 'On' : 'Off') : setting.value}
                  </span>
                </div>
                
                {setting.type === 'number' && setting.enabled && (
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1">
                      <label className="text-xs text-tv-gray-400">Min</label>
                      <input
                        type="number"
                        value={setting.min}
                        onChange={(e) => handleMinMaxChange(index, 'min', e.target.value)}
                        className="w-full bg-tv-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue"
                        step="any"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-tv-gray-400">Max</label>
                      <input
                        type="number"
                        value={setting.max}
                        onChange={(e) => handleMinMaxChange(index, 'max', e.target.value)}
                        className="w-full bg-tv-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue"
                        step="any"
                      />
                    </div>
                  </div>
                )}
                
                {setting.type === 'checkbox' && setting.enabled && (
                  <p className="text-xs text-tv-gray-400 mt-1">Will toggle between On/Off</p>
                )}
                
                {setting.type === 'select' && setting.enabled && (
                  <p className="text-xs text-tv-gray-400 mt-1">Will cycle through available options</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SettingsPanel; 