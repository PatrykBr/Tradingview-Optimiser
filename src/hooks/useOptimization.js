import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY_PREFIX = 'optimizer_state_';
const STORAGE_KEYS = {
  state: `${STORAGE_KEY_PREFIX}state`,
  settings: `${STORAGE_KEY_PREFIX}settings`,
  filters: `${STORAGE_KEY_PREFIX}filters`,
  results: `${STORAGE_KEY_PREFIX}results`,
  logs: `${STORAGE_KEY_PREFIX}logs`,
  progress: `${STORAGE_KEY_PREFIX}progress`
};

export function useOptimization() {
  const [optimizationState, setOptimizationState] = useState('idle'); // idle, running, stopped
  const [optimizationSettings, setOptimizationSettings] = useState({
    strategyIndex: 0,
    metric: 'netProfit',
    iterations: 100,
    deepBacktest: false,
    startDate: '',
    endDate: '',
    antiDetection: {
      minDelay: 500,
      maxDelay: 2000
    },
    parameters: []
  });
  const [filters, setFilters] = useState([]);
  const [results, setResults] = useState([]);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 100 });
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  
  const optimizerRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Helper function to save state to storage
  const saveToStorage = useCallback((key, value) => {
    chrome.storage.local.set({ [key]: value });
  }, []);

  // Helper function to load state from storage
  const loadFromStorage = useCallback((key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }, []);

  // Load persisted state on hook initialization
  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const [
          persistedState,
          persistedSettings,
          persistedFilters,
          persistedResults,
          persistedLogs,
          persistedProgress
        ] = await Promise.all([
          loadFromStorage(STORAGE_KEYS.state),
          loadFromStorage(STORAGE_KEYS.settings),
          loadFromStorage(STORAGE_KEYS.filters),
          loadFromStorage(STORAGE_KEYS.results),
          loadFromStorage(STORAGE_KEYS.logs),
          loadFromStorage(STORAGE_KEYS.progress)
        ]);

        if (persistedState) setOptimizationState(persistedState);
        if (persistedSettings) setOptimizationSettings(persistedSettings);
        if (persistedFilters) setFilters(persistedFilters);
        if (persistedResults) setResults(persistedResults);
        if (persistedLogs) setLogs(persistedLogs);
        if (persistedProgress) setProgress(persistedProgress);

        // Add a log entry if we're resuming an ongoing optimization
        if (persistedState === 'running' && persistedProgress && persistedProgress.current > 0) {
          const resumeLogEntry = {
            timestamp: Date.now(),
            level: 'info',
            message: `Optimization resumed - continuing from iteration ${persistedProgress.current}/${persistedProgress.total}`
          };
          setLogs(prev => [...(prev || []), resumeLogEntry]);
        }

        setIsStateLoaded(true);
      } catch (error) {
        console.error('Failed to load persisted state:', error);
        setIsStateLoaded(true);
      }
    };

    loadPersistedState();
  }, [loadFromStorage]);

  // Persist state changes to storage
  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.state, optimizationState);
  }, [optimizationState, isStateLoaded, saveToStorage]);

  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.settings, optimizationSettings);
  }, [optimizationSettings, isStateLoaded, saveToStorage]);

  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.filters, filters);
  }, [filters, isStateLoaded, saveToStorage]);

  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.results, results);
  }, [results, isStateLoaded, saveToStorage]);

  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.logs, logs);
  }, [logs, isStateLoaded, saveToStorage]);

  useEffect(() => {
    if (!isStateLoaded) return;
    saveToStorage(STORAGE_KEYS.progress, progress);
  }, [progress, isStateLoaded, saveToStorage]);

  // Send message to content script via background
  const sendToContent = useCallback(async (action, data = {}) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'forwardToContent',
        data: { action, ...data }
      }, (response) => {
        resolve(response);
      });
    });
  }, []);

  // Add log entry
  const addLog = useCallback((level, message) => {
    const logEntry = {
      timestamp: Date.now(),
      level,
      message
    };
    setLogs(prev => [...prev, logEntry]);
  }, []);

  // Update optimization settings
  const updateOptimizationSettings = useCallback((updates) => {
    setOptimizationSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Add filter
  const addFilter = useCallback((filter) => {
    setFilters(prev => [...prev, filter]);
    addLog('info', `Added filter: ${filter.metric} ${filter.min !== null ? `≥ ${filter.min}` : ''} ${filter.max !== null ? `≤ ${filter.max}` : ''}`);
  }, [addLog]);

  // Remove filter
  const removeFilter = useCallback((filterId) => {
    setFilters(prev => prev.filter(f => f.id !== filterId));
    addLog('info', `Removed filter`);
  }, [addLog]);

  // Apply filters to check if result is valid
  const applyFilters = useCallback(async (metrics) => {
    for (const filter of filters) {
      const value = metrics[filter.metric];
      if (value === null || value === undefined) continue;
      
      if (filter.min !== null && value < filter.min) {
        return false;
      }
      if (filter.max !== null && value > filter.max) {
        return false;
      }
    }
    return true;
  }, [filters]);

  // Start optimization
  const startOptimization = useCallback(async () => {
    // Clear previous state when starting new optimization
    if (optimizationState === 'running') return;
    
    // Clear previous results and logs when starting new optimization
    setResults([]);
    setLogs([]);
    setProgress({ current: 0, total: optimizationSettings.iterations });
    setOptimizationState('running');
    
    addLog('info', 'Sending startOptimization to background');
    await chrome.runtime.sendMessage({ action: 'startOptimization', settings: optimizationSettings, filters });
  }, [optimizationState, optimizationSettings, filters, addLog]);

  // Stop optimization
  const stopOptimization = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'stopOptimization' });
    setOptimizationState('stopped');
  }, []);

  // Listen for logs and results from background
  useEffect(() => {
    function handleBgMessage(request) {
      if (request.action === 'optimizationLog') {
        addLog(request.level, request.message);
      }
      if (request.action === 'optimizationResult') {
        setResults(prev => [...prev, request.result]);
      }
      if (request.action === 'optimizationCompleted') {
        setOptimizationState('idle');
      }
      if (request.action === 'optimizationProgress') {
        setProgress({ current: request.iteration, total: request.totalIterations });
      }
    }
    chrome.runtime.onMessage.addListener(handleBgMessage);
    return () => chrome.runtime.onMessage.removeListener(handleBgMessage);
  }, [addLog]);

  // Clear results and reset state
  const clearResults = useCallback(() => {
    setResults([]);
    setLogs([]);
    setProgress({ current: 0, total: optimizationSettings.iterations });
    setOptimizationState('idle');
    
    // Clear from storage as well
    chrome.storage.local.remove([
      STORAGE_KEYS.results,
      STORAGE_KEYS.logs,
      STORAGE_KEYS.progress,
      STORAGE_KEYS.state
    ]);
    
    addLog('info', 'Results cleared');
  }, [addLog, optimizationSettings.iterations]);

  // Apply best optimization result to TradingView
  const applyBestResult = useCallback(async (bestResult) => {
    if (!bestResult) {
      addLog('error', 'No best result to apply');
      return;
    }

    try {
      addLog('info', `Applying best result from iteration ${bestResult.iteration}`);
      
      // Convert the result settings to the format expected by applySettings
      const settingsToApply = Object.entries(bestResult.settings).map(([name, value]) => ({
        name,
        value
      }));
      
      // Send message to content script to apply the settings
      const response = await sendToContent('applySettings', {
        strategyIndex: optimizationSettings.strategyIndex,
        settings: settingsToApply
      });
      
      if (response.success) {
        addLog('success', 'Best optimization result applied successfully');
      } else {
        addLog('error', `Failed to apply result: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      addLog('error', `Error applying best result: ${error.message}`);
    }
  }, [addLog, sendToContent, optimizationSettings.strategyIndex]);

  // Export results to CSV format
  const exportToCSV = useCallback(() => {
    if (results.length === 0) {
      addLog('error', 'No results to export');
      return;
    }

    try {
      // Create CSV headers
      const headers = ['Iteration', 'Metric Value', 'Valid', 'Metric Type'];
      
      // Add parameter headers
      if (optimizationSettings.parameters && optimizationSettings.parameters.length > 0) {
        const paramNames = optimizationSettings.parameters.map(p => p.name);
        headers.push(...paramNames);
      }
      
      // Create CSV rows
      const rows = results.map(result => {
        const row = [
          result.iteration,
          result.value,
          result.isValid ? 'Yes' : 'No',
          result.metric
        ];
        
        // Add parameter values
        if (optimizationSettings.parameters && optimizationSettings.parameters.length > 0) {
          const paramValues = optimizationSettings.parameters.map(p => 
            result.settings[p.name] !== undefined ? result.settings[p.name] : ''
          );
          row.push(...paramValues);
        }
        
        return row;
      });
      
      // Combine headers and rows
      const csvContent = [headers, ...rows]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');
      
      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `optimization_results_${Date.now()}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      addLog('success', `Exported ${results.length} results to CSV`);
    } catch (error) {
      addLog('error', `Error exporting to CSV: ${error.message}`);
    }
  }, [results, optimizationSettings.parameters, addLog]);

  // Export results to JSON format
  const exportToJSON = useCallback(() => {
    if (results.length === 0) {
      addLog('error', 'No results to export');
      return;
    }

    try {
      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          optimizationSettings: optimizationSettings,
          filters: filters,
          totalResults: results.length,
          validResults: results.filter(r => r.isValid).length
        },
        results: results
      };
      
      const jsonContent = JSON.stringify(exportData, null, 2);
      
      // Create and download file
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `optimization_results_${Date.now()}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      addLog('success', `Exported ${results.length} results to JSON`);
    } catch (error) {
      addLog('error', `Error exporting to JSON: ${error.message}`);
    }
  }, [results, optimizationSettings, filters, addLog]);

  return {
    optimizationState,
    optimizationSettings,
    filters,
    results,
    logs,
    startOptimization,
    stopOptimization,
    updateOptimizationSettings,
    addFilter,
    removeFilter,
    clearResults,
    applyBestResult,
    exportToCSV,
    exportToJSON,
    progress,
    isStateLoaded
  };
} 