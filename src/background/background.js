// Background service worker for TradingView Strategy Optimizer

// Optimization state
let optimizer = null;
let abortOptimization = false;
let currentOptimizationState = 'idle'; // Track optimization state in background

// Storage keys for persistence
const STORAGE_KEY_PREFIX = 'optimizer_state_';
const STORAGE_KEYS = {
  state: `${STORAGE_KEY_PREFIX}state`,
  settings: `${STORAGE_KEY_PREFIX}settings`,
  filters: `${STORAGE_KEY_PREFIX}filters`,
  results: `${STORAGE_KEY_PREFIX}results`,
  logs: `${STORAGE_KEY_PREFIX}logs`,
  progress: `${STORAGE_KEY_PREFIX}progress`
};

// Helper: save to storage
function saveToStorage(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}

// Helper: load from storage
function loadFromStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

// Helper: send log messages to popup UI and storage
async function sendLog(level, message) {
  console.log(`[BG] ${level.toUpperCase()} ${message}`);
  
  // Send to popup if it's open
  chrome.runtime.sendMessage({ action: 'optimizationLog', level, message }).catch(() => {
    // Popup might be closed, that's ok
  });
  
  // Also save to storage (synchronously to avoid race conditions)
  try {
    const logs = await loadFromStorage(STORAGE_KEYS.logs);
    const currentLogs = logs || [];
    const logEntry = {
      timestamp: Date.now(),
      level,
      message
    };
    const updatedLogs = [...currentLogs, logEntry];
    await saveToStorage(STORAGE_KEYS.logs, updatedLogs);
  } catch (error) {
    console.error('Failed to save log to storage:', error);
  }
}

// Helper: send individual result to popup UI and storage
async function sendResult(result) {
  // Send to popup if it's open
  chrome.runtime.sendMessage({ action: 'optimizationResult', result }).catch(() => {
    // Popup might be closed, that's ok
  });
  
  // Also save to storage (synchronously to avoid race conditions)
  try {
    const results = await loadFromStorage(STORAGE_KEYS.results);
    const currentResults = results || [];
    const updatedResults = [...currentResults, result];
    await saveToStorage(STORAGE_KEYS.results, updatedResults);
  } catch (error) {
    console.error('Failed to save result to storage:', error);
  }
}

// Helper: update optimization progress
function updateProgress(iteration, totalIterations) {
  const progress = { current: iteration, total: totalIterations };
  
  // Send to popup if it's open
  chrome.runtime.sendMessage({ action: 'optimizationProgress', iteration, totalIterations }).catch(() => {
    // Popup might be closed, that's ok
  });
  
  // Save to storage
  saveToStorage(STORAGE_KEYS.progress, progress);
}

// Helper: update optimization state
function updateOptimizationState(state) {
  currentOptimizationState = state;
  saveToStorage(STORAGE_KEYS.state, state);
  
  // Send to popup if it's open
  if (state === 'idle') {
    chrome.runtime.sendMessage({ action: 'optimizationCompleted' }).catch(() => {
      // Popup might be closed, that's ok
    });
  }
}

// Helper: forward a message to the active TradingView tab's content script and await response
function sendToContent(action, data = {}) {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        resolve({ success: false, error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, (response) => resolve(response || {}));
    });
  });
}

// Calculate the maximum possible combinations for exhaustive search
function calculateMaxCombinations(params) {
  let combos = 1;
  params.forEach(param => {
    if (param.type === 'number') {
      const range = param.max - param.min;
      const isFloat = param.min % 1 !== 0 || param.max % 1 !== 0;
      const step = isFloat ? 0.01 : 1;
      combos *= Math.floor(range / step) + 1;
    } else if (param.type === 'checkbox') {
      combos *= 2;
    } else if (param.type === 'select' && Array.isArray(param.options)) {
      combos *= param.options.length;
    }
  });
  return combos;
}

// Generate all combinations of parameter values for exhaustive search
function generateCombinations(params) {
  const lists = params.map(param => {
    if (param.type === 'number') {
      const isFloat = param.min % 1 !== 0 || param.max % 1 !== 0;
      const multiplier = isFloat ? 100 : 1;
      const start = Math.round(param.min * multiplier);
      const end = Math.round(param.max * multiplier);
      const step = isFloat ? 1 : multiplier;
      const values = [];
      for (let v = start; v <= end; v += step) {
        values.push(isFloat ? v / multiplier : v / multiplier);
      }
      return values;
    } else if (param.type === 'checkbox') {
      return [false, true];
    } else if (param.type === 'select' && Array.isArray(param.options)) {
      return param.options;
    }
    return [];
  });

  const combos = [];
  function helper(idx, current) {
    if (idx === params.length) {
      combos.push({ ...current });
      return;
    }
    const param = params[idx];
    lists[idx].forEach(value => {
      current[param.name] = value;
      helper(idx + 1, current);
    });
  }
  helper(0, {});
  return combos;
}

// Bayesian optimization session management
let currentSessionId = null;
const SERVER_URL = 'http://localhost:5000';

// Convert extension parameters to server format
function convertParametersToServerFormat(params) {
  return params.map(param => {
    const serverParam = {
      name: param.name,
      type: param.type
    };
    
    if (param.type === 'number') {
      serverParam.min_val = param.min;
      serverParam.max_val = param.max;
      serverParam.is_integer = (param.min % 1 === 0 && param.max % 1 === 0);
    } else if (param.type === 'select' && param.options) {
      serverParam.options = param.options;
    }
    
    return serverParam;
  });
}

// Convert filters to server format
function convertFiltersToServerFormat(filters) {
  return filters.map(filter => ({
    metric: filter.metric,
    min_val: filter.min,
    max_val: filter.max
  }));
}

// Make API call to optimization server
async function callOptimizationServer(endpoint, data) {
  try {
    const response = await fetch(`${SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    // Check if server is running
    if (error.message.includes('fetch')) {
      throw new Error('Optimization server not running. Please start the server using: python start_server.py');
    }
    throw error;
  }
}

// Initialize Bayesian optimization session
async function initializeBayesianSession(parameters, metric, filters, iterations, useSobol = true) {
  const serverParams = convertParametersToServerFormat(parameters);
  const serverFilters = convertFiltersToServerFormat(filters);
  
  const response = await callOptimizationServer('/start_optimization', {
    parameters: serverParams,
    target_metric: metric,
    filters: serverFilters,
    max_iterations: iterations,
    use_sobol: useSobol
  });
  
  if (!response.success) {
    throw new Error(`Failed to initialize optimization: ${response.error}`);
  }
  
  return response.session_id;
}

// Get next parameter suggestion from Bayesian optimizer
async function getNextParameters(sessionId) {
  const response = await callOptimizationServer('/suggest_parameters', {
    session_id: sessionId
  });
  
  if (!response.success) {
    throw new Error(`Failed to get parameter suggestion: ${response.error}`);
  }
  
  return response.parameters;
}

// Register optimization result with Bayesian optimizer
async function registerOptimizationResult(sessionId, parameters, metrics) {
  const response = await callOptimizationServer('/register_result', {
    session_id: sessionId,
    parameters: parameters,
    metrics: metrics
  });
  
  if (!response.success) {
    throw new Error(`Failed to register result: ${response.error}`);
  }
  
  return response;
}

// Core Bayesian optimization loop with LHS initial sampling
async function runOptimization(settings) {
  const { metric, iterations, deepBacktest, startDate, endDate, antiDetection, parameters, filters, strategyIndex = 0, useSobol = true } = settings;
  abortOptimization = false;
  
  // Update state and clear previous results
  updateOptimizationState('running');
  await saveToStorage(STORAGE_KEYS.settings, settings);
  await saveToStorage(STORAGE_KEYS.filters, filters);
  await saveToStorage(STORAGE_KEYS.results, []);
  await saveToStorage(STORAGE_KEYS.logs, []);
  updateProgress(0, iterations);
  
  try {
    await sendLog('info', `Starting Bayesian optimization with ${useSobol ? 'Sobol sequence' : 'LHS'} initial sampling...`);
    await chrome.storage.local.set({ antiDetection });
    
    // Synchronize deep backtest state between extension and TradingView
    await sendLog('debug', 'Synchronizing deep backtest settings...');
    await sendToContent('syncDeepBacktest', { enabled: deepBacktest });
    
    if (deepBacktest) {
      if (startDate || endDate) {
        await sendLog('debug', `Setting date range: ${startDate} to ${endDate}`);
        await sendToContent('setDateRange', { startDate, endDate });
      }
    }
    
    const enabledParams = parameters.filter(p => p.enabled);
    if (enabledParams.length === 0) throw new Error('No parameters selected for optimization');
    
    // First, capture current settings and test them (iteration 0)
    await sendLog('info', 'Capturing current settings for baseline evaluation...');
    const currentSettingsResp = await sendToContent('readStrategySettings', { strategyIndex });
    if (!currentSettingsResp.success) {
      throw new Error('Failed to read current strategy settings');
    }
    
    const currentSettings = currentSettingsResp.settings;
    await sendLog('debug', `Current settings: ${JSON.stringify(currentSettings)}`);
    
    // Create a mapping of current values for enabled parameters
    const currentParams = {};
    for (const param of enabledParams) {
      const currentSetting = currentSettings.find(s => s.name === param.name);
      if (currentSetting) {
        currentParams[param.name] = currentSetting.value;
      } else {
        // Fallback to parameter default if current setting not found
        currentParams[param.name] = param.default || param.min || false;
        await sendLog('warning', `Current value not found for parameter ${param.name}, using fallback: ${currentParams[param.name]}`);
      }
    }
    
    await sendLog('info', 'Testing current settings as baseline (iteration 0)...');
    updateProgress(0, iterations + 1); // +1 because we're adding iteration 0
    
    // Test current settings first
    if (deepBacktest) {
      await sendLog('debug', 'Checking date range for deep backtest...');
      if (startDate || endDate) {
        await sendLog('debug', `Setting date range: ${startDate} to ${endDate}`);
        await sendToContent('setDateRange', { startDate, endDate });
      }
      await sendLog('debug', 'Generating deep backtest report with current settings...');
    } else {
      await sendLog('debug', 'Waiting for backtest to complete with current settings...');
      await sendToContent('waitForBacktestComplete');
    }
    
    // Read metrics for current settings
    await sendLog('debug', 'Reading metrics for current settings...');
    const metricNames = [...new Set([metric, ...filters.map(f => f.metric)])];
    const currentMetricsResp = await sendToContent('readAllMetrics', { metricNames });
    if (!currentMetricsResp.success) throw new Error('Failed to read metrics for current settings');
    
    const currentValues = currentMetricsResp.metrics;
    const currentMetricValue = currentValues[metric];
    await sendLog('info', `Current settings baseline - ${metric}: ${currentMetricValue}`);
    
    // Initialize Bayesian optimization session
    await sendLog('info', 'Initializing Bayesian optimization server...');
    currentSessionId = await initializeBayesianSession(enabledParams, metric, filters, iterations, useSobol);
    await sendLog('info', `Created optimization session: ${currentSessionId}`);
    
    // Register the current settings as the first result
    await sendLog('debug', 'Registering current settings with optimizer...');
    const currentRegistrationResult = await registerOptimizationResult(currentSessionId, currentParams, currentValues);
    const currentResultInfo = currentRegistrationResult.result_info || {};
    
    let bestResult = null;
    let allResults = [];
    let validResultsCount = 0;
    
    // Handle the current settings result
    if (currentResultInfo.is_valid) {
      validResultsCount++;
      bestResult = { 
        iteration: 0, 
        settings: currentParams, 
        value: currentMetricValue, 
        metric, 
        isValid: true 
      };
    }
    
    // Emit result for UI
    const currentResult = { 
      iteration: 0, 
      settings: currentParams, 
      value: currentMetricValue, 
      metric, 
      isValid: currentResultInfo.is_valid,
      isBest: currentResultInfo.is_best
    };
    
    allResults.push(currentResult);
    await sendResult(currentResult);
    
    await sendLog('info', `Starting optimization from iteration 1 (${enabledParams.length} parameters over ${iterations} iterations using ${useSobol ? 'Sobol' : 'LHS'} + Bayesian optimization)`);
    
    for (let i = 1; i <= iterations; i++) {
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      // Update progress
      updateProgress(i, iterations + 1); // +1 because we added iteration 0
      
      // Get next parameter suggestion from Bayesian optimizer (uses LHS for initial samples)
      const suggestedParams = await getNextParameters(currentSessionId);
      if (!suggestedParams) {
        await sendLog('info', 'No more parameter suggestions available');
        break;
      }
      
      // Check abort after getting parameters
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      await sendLog('info', `Iteration ${i}/${iterations}, params: ${JSON.stringify(suggestedParams)}`);
      
      // Apply new settings
      const settingsToApply = enabledParams.map(p => ({ name: p.name, type: p.type, value: suggestedParams[p.name] }));
      await sendToContent('applySettings', { strategyIndex, settings: settingsToApply });
      
      // Check abort after applying settings
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      if (deepBacktest) {
        await sendLog('debug', 'Generating deep backtest report...');
        await sendToContent('setDateRange', { startDate, endDate });
      } else {
        await sendLog('debug', 'Waiting for backtest to complete...');
        await sendToContent('waitForBacktestComplete');
      }
      
      // Check abort after backtest
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      await sendLog('debug', 'Reading metrics...');
      const metricNames = [...new Set([metric, ...filters.map(f => f.metric)])];
      await sendLog('debug', `Reading metrics: ${JSON.stringify(metricNames)}`);
      const metricsResp = await sendToContent('readAllMetrics', { metricNames });
      if (!metricsResp.success) throw new Error('Failed to read metrics');
      
      // Check abort after reading metrics
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      const values = metricsResp.metrics;
      await sendLog('debug', `Metrics received: ${JSON.stringify(values)}`);
      const metricValue = values[metric];
      
      // Register result with Bayesian optimizer
      const registrationResult = await registerOptimizationResult(currentSessionId, suggestedParams, values);
      await sendLog('debug', `Server response: ${JSON.stringify(registrationResult)}`);
      const resultInfo = registrationResult.result_info || {};
      const isValid = resultInfo.is_valid;
      const isBest = resultInfo.is_best;
      
      if (isValid) {
        validResultsCount++;
        if (isBest) {
          bestResult = { 
            iteration: i, 
            settings: suggestedParams, 
            value: metricValue, 
            metric, 
            isValid: true 
          };
        }
      }
      
      await sendLog('debug', `Result registered - Valid: ${isValid}, Best: ${isBest}, Total valid: ${resultInfo.total_valid_results}`);
      
      // Emit result for UI
      const result = { 
        iteration: i, 
        settings: suggestedParams, 
        value: metricValue, 
        metric, 
        isValid, 
        isBest
      };
      
      allResults.push(result);
      await sendResult(result);
    }
    
    // Final summary
    if (abortOptimization) {
      await sendLog('info', 'Optimization was stopped by user');
    } else if (bestResult) {
      await sendLog('info', `Bayesian optimization complete! Best ${metric}: ${bestResult.value}`);
      await sendLog('info', `Best settings: ${JSON.stringify(bestResult.settings)}`);
      await sendLog('info', `Total valid results: ${validResultsCount}/${allResults.length}`);
      
      await sendResult({ 
        iteration: 'best', 
        settings: bestResult.settings, 
        value: bestResult.value, 
        metric, 
        isValid: true, 
        isBest: true
      });
    } else {
      await sendLog('info', 'Optimization complete! No valid results found.');
    }
    
  } catch (error) {
    await sendLog('error', `Optimization error: ${error.message}`);
  } finally {
    if (deepBacktest) {
      await sendToContent('syncDeepBacktest', { enabled: false });
    }
    
    // Clean up session
    if (currentSessionId) {
      try {
        await callOptimizationServer('/stop_optimization', { session_id: currentSessionId });
        currentSessionId = null;
      } catch (error) {
        await sendLog('warning', `Failed to clean up session: ${error.message}`);
      }
    }
    
    abortOptimization = false;
    updateOptimizationState('idle');
  }
}

// Handle messages from popup and content script forwarding
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'startOptimization':
      runOptimization({ ...request.settings, filters: request.filters });
      sendResponse({ success: true });
      return true;
    case 'stopOptimization':
      abortOptimization = true;
      // Also notify content script to abort current operation
      sendToContent('abortOperation').then(() => {
        console.log('Sent abort signal to content script');
      }).catch(() => {
        // Content script might not be available, that's ok
      });
      updateOptimizationState('stopped');
      // Send immediate feedback to user
      sendLog('info', 'Stopping optimization...');
      sendResponse({ success: true });
      return true;
    case 'getOptimizationState':
      // Allow popup to query current optimization state
      sendResponse({ 
        state: currentOptimizationState,
        success: true 
      });
      return true;
    case 'checkTradingView':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const isValidPage = tabs[0]?.url?.includes('tradingview.com/chart');
        sendResponse({ isValid: isValidPage, tabId: tabs[0]?.id });
      });
      return true;
    case 'forwardToContent':
      // Forward message to content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, request.data, sendResponse);
        } else {
          sendResponse({ success: false, error: 'No active tab' });
        }
      });
      return true;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return true;
  }
});

// Initialize background state on startup
chrome.runtime.onStartup.addListener(() => {
  updateOptimizationState('idle');
});

chrome.runtime.onInstalled.addListener(() => {
  updateOptimizationState('idle');
});

// Handle tab updates to check if content script needs injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('tradingview.com/chart')) {
    console.log('TradingView chart page loaded');
  }
}); 