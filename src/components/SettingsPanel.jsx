import React, { useState, useEffect } from 'react';

function SettingsPanel({ settings, isLoading, onRefresh, onUpdateSettings, onApplyCurrentValues, savedParameters }) {
  const [localSettings, setLocalSettings] = useState([]);
  const [isApplying, setIsApplying] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);

  useEffect(() => {
    // Initialize settings: only populate when saved parameters exist, otherwise start empty
    if (Array.isArray(savedParameters) && savedParameters.length > 0) {
      setLocalSettings(savedParameters);
    } else if (Array.isArray(settings)) {
      setLocalSettings(settings.map(setting => ({
        ...setting,
        enabled: false,
        min: '',
        max: ''
      })));
    }
  }, [settings, savedParameters]);

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

  const handleCurrentValueChange = (index, value) => {
    const updated = [...localSettings];
    const setting = updated[index];
    
    if (setting.type === 'number') {
      updated[index].value = value === '' ? '' : parseFloat(value);
    } else if (setting.type === 'checkbox') {
      updated[index].value = value;
    } else if (setting.type === 'select') {
      updated[index].value = value;
    }
    
    setLocalSettings(updated);
    onUpdateSettings(updated);
  };

  const handleApplyCurrentValues = async () => {
    if (!onApplyCurrentValues || localSettings.length === 0) return;
    
    setIsApplying(true);
    try {
      await onApplyCurrentValues(localSettings);
      // Close edit mode after successful apply
      setEditingIndex(null);
    } catch (error) {
      console.error('Failed to apply current values:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const toggleEditMode = (index) => {
    setEditingIndex(editingIndex === index ? null : index);
  };

  if (isLoading) {
    return (
      <div className="bg-tv-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-tv-blue border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-tv-gray-300">Reading strategy settings...</span>
        </div>
      </div>
    );
  }

  if (!settings || settings.length === 0) {
    return (
      <div className="bg-tv-gray-800 rounded-lg p-4 text-center">
        <div className="text-tv-gray-400 mb-3">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-sm">No parameters available</p>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-2 bg-tv-blue text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
        >
          Refresh Settings
        </button>
      </div>
    );
  }

  const enabledCount = localSettings.filter(s => s.enabled).length;
  const hasEditableValues = editingIndex !== null;

  return (
    <div className="bg-tv-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Parameters</span>
          {enabledCount > 0 && (
            <span className="bg-tv-blue text-white text-xs px-2 py-1 rounded-full">
              {enabledCount} enabled
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasEditableValues && (
            <button
              onClick={handleApplyCurrentValues}
              disabled={isApplying || localSettings.length === 0}
              className="px-2 py-1 bg-tv-blue text-white rounded text-xs hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Apply current values to TradingView"
            >
              {isApplying ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Applying...</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Apply Values</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={onRefresh}
            className="p-1 text-tv-gray-400 hover:text-white transition-colors"
            title="Refresh settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto overflow-x-hidden pr-2">
        {localSettings.map((setting, index) => (
          <div key={index} className={`border rounded-lg p-3 transition-colors ${
            setting.enabled ? 'border-tv-blue/50 bg-tv-blue/10' : 'border-tv-gray-700 bg-tv-gray-700/30'
          }`}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={setting.enabled}
                onChange={() => handleToggleSetting(index)}
                className="mt-0.5 w-4 h-4 text-tv-blue bg-tv-gray-700 border-tv-gray-600 rounded focus:ring-tv-blue focus:ring-1 flex-shrink-0"
              />
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label className="text-sm font-medium text-white truncate flex-1 min-w-0">{setting.name}</label>
                  
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-tv-gray-400 truncate max-w-[100px]">
                      {setting.type === 'checkbox' ? (setting.value ? 'On' : 'Off') : setting.value}
                    </span>
                    <button
                      onClick={() => toggleEditMode(index)}
                      className={`p-1 rounded hover:bg-tv-gray-600 transition-colors ${
                        editingIndex === index ? 'text-tv-blue bg-tv-gray-600' : 'text-tv-gray-400'
                      }`}
                      title="Edit current value"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {/* Current Value Input - Only visible when editing */}
                {editingIndex === index && (
                  <div className="mt-2 p-2 bg-tv-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-tv-gray-300">Value:</span>
                      {setting.type === 'number' && (
                        <input
                          type="number"
                          value={setting.value}
                          onChange={(e) => handleCurrentValueChange(index, e.target.value)}
                          className="flex-1 bg-tv-gray-600 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue"
                          step="any"
                        />
                      )}
                      {setting.type === 'checkbox' && (
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={setting.value}
                            onChange={(e) => handleCurrentValueChange(index, e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4 bg-tv-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-tv-blue"></div>
                        </label>
                      )}
                      {setting.type === 'select' && setting.options && (
                        <select
                          value={setting.value}
                          onChange={(e) => handleCurrentValueChange(index, e.target.value)}
                          className="flex-1 bg-tv-gray-600 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue"
                        >
                          {setting.options.map((option, optIdx) => (
                            <option key={optIdx} value={option}>{option}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
                
                {setting.type === 'number' && setting.enabled && (
                  <div className="flex gap-2 mt-1">
                    <div className="flex-1">
                      <label className="text-xs text-tv-gray-400 block mb-1">Min</label>
                      <input
                        type="number"
                        value={setting.min}
                        onChange={(e) => handleMinMaxChange(index, 'min', e.target.value)}
                        className="w-full bg-tv-gray-600 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue"
                        step="any"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-tv-gray-400 block mb-1">Max</label>
                      <input
                        type="number"
                        value={setting.max}
                        onChange={(e) => handleMinMaxChange(index, 'max', e.target.value)}
                        className="w-full bg-tv-gray-600 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-tv-blue"
                        step="any"
                      />
                    </div>
                  </div>
                )}
                
                {setting.type === 'checkbox' && setting.enabled && (
                  <p className="text-xs text-tv-gray-400 mt-1">Will test both On/Off</p>
                )}
                
                {setting.type === 'select' && setting.enabled && (
                  <p className="text-xs text-tv-gray-400 mt-1">Will test all options</p>
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