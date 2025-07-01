import React, { useState, useEffect } from 'react';

function ConfigManager({ selectedStrategy, optimizationSettings }) {
  const [configs, setConfigs] = useState([]);
  const [currentConfigName, setCurrentConfigName] = useState('');
  const [newConfigName, setNewConfigName] = useState('');

  // Storage utility functions
  const loadFromStorage = (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  };

  const saveToStorage = (key, value) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  };

  // Load configs when strategy changes
  useEffect(() => {
    if (selectedStrategy) {
      loadConfigs();
    }
  }, [selectedStrategy]);

  const loadConfigs = async () => {
    const key = `configs_${selectedStrategy.index}`;
    const data = await loadFromStorage(key);
    setConfigs(Array.isArray(data) ? data : []);
    setCurrentConfigName('');
    setNewConfigName('');
  };

  const saveConfig = async () => {
    if (!newConfigName.trim() || !selectedStrategy) return;
    
    const key = `configs_${selectedStrategy.index}`;
    const newConfig = { name: newConfigName.trim(), settings: optimizationSettings };
    const filtered = configs.filter(c => c.name !== newConfig.name);
    const updated = [...filtered, newConfig];
    
    await saveToStorage(key, updated);
    setConfigs(updated);
    setCurrentConfigName(newConfig.name);
    setNewConfigName('');
  };

  const loadConfig = (name) => {
    const config = configs.find(c => c.name === name);
    if (config && config.settings) {
      // Send event to parent to update optimization settings
      const event = new CustomEvent('loadConfig', { detail: config.settings });
      window.dispatchEvent(event);
      setCurrentConfigName(name);
    }
  };

  const deleteConfig = async (name) => {
    if (!selectedStrategy) return;
    
    const key = `configs_${selectedStrategy.index}`;
    const updated = configs.filter(c => c.name !== name);
    
    await saveToStorage(key, updated);
    setConfigs(updated);
    if (currentConfigName === name) setCurrentConfigName('');
  };

  return (
    <div className="bg-tv-gray-800 rounded p-4 mt-4">
      <h3 className="text-lg font-semibold text-white mb-2">Saved Configurations</h3>
      <div className="flex items-center mb-2">
        <select
          value={currentConfigName}
          onChange={(e) => setCurrentConfigName(e.target.value)}
          className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
        >
          <option value="">Select a config</option>
          {configs.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => loadConfig(currentConfigName)}
          disabled={!currentConfigName}
          className="ml-2 px-3 py-2 bg-tv-blue text-white rounded disabled:opacity-50 cursor-pointer"
        >
          Load
        </button>
        <button
          onClick={() => deleteConfig(currentConfigName)}
          disabled={!currentConfigName}
          className="ml-2 px-3 py-2 bg-tv-red text-white rounded disabled:opacity-50 cursor-pointer"
        >
          Delete
        </button>
      </div>
      <div className="flex items-center">
        <input
          type="text"
          placeholder="New config name"
          value={newConfigName}
          onChange={(e) => setNewConfigName(e.target.value)}
          className="flex-1 bg-tv-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-tv-blue"
        />
        <button
          onClick={saveConfig}
          disabled={!newConfigName.trim()}
          className="ml-2 px-3 py-2 bg-tv-green text-white rounded disabled:opacity-50 cursor-pointer"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default ConfigManager; 