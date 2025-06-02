import { useState, useCallback, useRef, useEffect } from 'react';
import BayesianOptimizer from '../services/bayesianOptimizer';

export function useOptimization() {
  const [optimizationState, setOptimizationState] = useState('idle'); // idle, running, stopped
  const [optimizationSettings, setOptimizationSettings] = useState({
    metric: 'netProfit',
    iterations: 50,
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
  const [progress, setProgress] = useState({ current: 0, total: optimizationSettings.iterations });
  
  const optimizerRef = useRef(null);
  const abortControllerRef = useRef(null);

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
    // Start the background optimization process
    if (optimizationState === 'running') return;
    setOptimizationState('running');
    setResults([]);
    setLogs([]);
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

  // Clear results
  const clearResults = useCallback(() => {
    setResults([]);
    addLog('info', 'Results cleared');
  }, [addLog]);

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
    progress
  };
} 