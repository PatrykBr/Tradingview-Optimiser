// Background service worker for TradingView Strategy Optimizer

// Optimization state
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

// Common storage utilities
const StorageUtils = {
  save(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },
  
  load(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key]));
    });
  },
  
  sendMessageSafe(message) {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, that's ok
    });
  }
};

/**
 * Send log message to popup UI and storage
 * @param {string} level - Log level (info, warning, error, debug)
 * @param {string} message - Log message
 * @returns {Promise<void>}
 */
async function sendLog(level, message) {
  // Send to popup if it's open
  StorageUtils.sendMessageSafe({ action: 'optimizationLog', level, message });
  
  // Also save to storage
  try {
    const logs = await StorageUtils.load(STORAGE_KEYS.logs) || [];
    const updatedLogs = [...logs, { timestamp: Date.now(), level, message }];
    await StorageUtils.save(STORAGE_KEYS.logs, updatedLogs);
  } catch (error) {
    console.error('Failed to save log to storage:', error);
  }
}

/**
 * Send optimization result to popup UI and storage
 * @param {Object} result - Optimization result object
 * @returns {Promise<void>}
 */
async function sendResult(result) {
  // Send to popup if it's open
  StorageUtils.sendMessageSafe({ action: 'optimizationResult', result });
  
  // Also save to storage
  try {
    const results = await StorageUtils.load(STORAGE_KEYS.results) || [];
    const updatedResults = [...results, result];
    await StorageUtils.save(STORAGE_KEYS.results, updatedResults);
  } catch (error) {
    console.error('Failed to save result to storage:', error);
  }
}

/**
 * Update optimization progress
 * @param {number} iteration - Current iteration number
 * @param {number} totalIterations - Total number of iterations
 */
function updateProgress(iteration, totalIterations) {
  const progress = { current: iteration, total: totalIterations };
  
  // Send to popup if it's open
  StorageUtils.sendMessageSafe({ action: 'optimizationProgress', iteration, totalIterations });
  
  // Save to storage
  StorageUtils.save(STORAGE_KEYS.progress, progress);
}

/**
 * Update optimization state
 * @param {string} state - New state (idle, running, stopped)
 */
function updateOptimizationState(state) {
  currentOptimizationState = state;
  StorageUtils.save(STORAGE_KEYS.state, state);
  
  // Send to popup if it's open
  if (state === 'idle') {
    StorageUtils.sendMessageSafe({ action: 'optimizationCompleted' });
  }
}

/**
 * Forward a message to the active TradingView tab's content script
 * @param {string} action - Action to perform
 * @param {Object} data - Additional data for the action
 * @returns {Promise<Object>} Response from content script
 */
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

// Bayesian optimization session management
let currentSessionId = null;
const SERVER_URL = 'http://localhost:5000';

/**
 * Convert extension parameters to server format
 * @param {Array} params - Extension parameter format
 * @returns {Array} Server parameter format
 */
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

/**
 * Convert filters to server format
 * @param {Array} filters - Extension filter format
 * @returns {Array} Server filter format
 */
function convertFiltersToServerFormat(filters) {
  return filters.map(filter => ({
    metric: filter.metric,
    min_val: filter.min,
    max_val: filter.max
  }));
}

/**
 * Make API call to optimization server
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request data
 * @returns {Promise<Object>} Server response
 * @throws {Error} If server is not running or returns error
 */
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

/**
 * Initialize Bayesian optimization session
 * @param {Array} parameters - Strategy parameters to optimize
 * @param {string} metric - Target metric to optimize
 * @param {Array} filters - Metric constraints
 * @param {number} iterations - Maximum number of iterations
 * @param {boolean} useSobol - Whether to use Sobol sequence for initial sampling
 * @returns {Promise<string>} Session ID
 */
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

/**
 * Get next parameter suggestion from Bayesian optimizer
 * @param {string} sessionId - Optimization session ID
 * @returns {Promise<Object|null>} Suggested parameters or null if optimization complete
 */
async function getNextParameters(sessionId) {
  const response = await callOptimizationServer('/suggest_parameters', {
    session_id: sessionId
  });
  
  if (!response.success) {
    throw new Error(`Failed to get parameter suggestion: ${response.error}`);
  }
  
  return response.parameters;
}

/**
 * Register optimization result with Bayesian optimizer
 * @param {string} sessionId - Optimization session ID
 * @param {Object} parameters - Tested parameters
 * @param {Object} metrics - Resulting metrics
 * @returns {Promise<Object>} Registration result with validation info
 */
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

/**
 * Core Bayesian optimization loop
 * @param {Object} settings - Optimization settings
 * @returns {Promise<void>}
 */
async function runOptimization(settings) {
  const { metric, iterations, deepBacktest, startDate, endDate, antiDetection, parameters, filters, strategyIndex = 0, useSobol = true } = settings;
  abortOptimization = false;
  
  // Update state and clear previous results
  updateOptimizationState('running');
  await StorageUtils.save(STORAGE_KEYS.settings, settings);
  await StorageUtils.save(STORAGE_KEYS.filters, filters);
  await StorageUtils.save(STORAGE_KEYS.results, []);
  await StorageUtils.save(STORAGE_KEYS.logs, []);
  updateProgress(0, iterations);
  
  try {
    await sendLog('info', `Starting Bayesian optimization with ${useSobol ? 'Sobol sequence' : 'LHS'} initial sampling...`);
    await chrome.storage.local.set({ antiDetection });
    
    // Set date range if provided
    if (startDate || endDate) {
      await sendToContent('setDateRange', { startDate, endDate });
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
    updateProgress(0, iterations); // Fixed: use actual iterations count
    
    // Test current settings first - wait for backtest to complete
    await sendToContent('waitForBacktestComplete');
    
    // Read metrics for current settings
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
    const currentRegistrationResult = await registerOptimizationResult(currentSessionId, currentParams, currentValues);
    const currentResultInfo = currentRegistrationResult.result_info || {};
    
    // Check baseline filter results
    if (!currentResultInfo.is_valid) {
      const filterFailures = [];
      for (const filter of filters) {
        const filterMetricValue = currentValues[filter.metric];
        if (filterMetricValue !== null && filterMetricValue !== undefined) {
          if (filter.min !== null && filterMetricValue < filter.min) {
            filterFailures.push(`${filter.metric}=${filterMetricValue} < min=${filter.min}`);
          }
          if (filter.max !== null && filterMetricValue > filter.max) {
            filterFailures.push(`${filter.metric}=${filterMetricValue} > max=${filter.max}`);
          }
        }
      }
      if (filterFailures.length > 0) {
        await sendLog('info', `Baseline result filtered out - Failed filters: ${filterFailures.join(', ')}`);
      }
    }
    
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
    
    // Main optimization loop - limit memory usage by keeping only recent results in memory
    const MAX_RESULTS_IN_MEMORY = 100;
    
    for (let i = 1; i <= iterations; i++) {
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      // Update progress - fixed to show proper percentage
      updateProgress(i, iterations);
      
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
      
      // Apply anti-detection delay between backtests
      if (antiDetection && i > 1) {
        const randomDelay = Math.random() * (antiDetection.maxDelay - antiDetection.minDelay) + antiDetection.minDelay;
        await sendLog('debug', `Anti-detection delay: ${Math.round(randomDelay)}ms`);
        await new Promise(resolve => setTimeout(resolve, randomDelay));
      }
      
      // Wait for backtest to complete
      await sendToContent('waitForBacktestComplete');
      
      // Check abort after backtest
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      // Small delay to ensure UI is stable before reading metrics
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const metricNames = [...new Set([metric, ...filters.map(f => f.metric)])];
      const metricsResp = await sendToContent('readAllMetrics', { metricNames });
      
      // Enhanced error handling for metric reading
      if (!metricsResp.success) {
        await sendLog('error', `Failed to read metrics: ${metricsResp.error || 'Unknown error'}`);
        
        // Retry with a longer delay
        await sendLog('info', 'Retrying metric reading after delay...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const retryResp = await sendToContent('readAllMetrics', { metricNames });
        if (!retryResp.success) {
          await sendLog('error', `Failed to read metrics after retry: ${retryResp.error || 'Unknown error'}`);
          
          // Skip this iteration but continue optimization
          const result = { 
            iteration: i, 
            settings: suggestedParams, 
            value: null, 
            metric, 
            isValid: false,
            isBest: false,
            error: retryResp.error || 'Failed to read metrics'
          };
          
          allResults.push(result);
          await sendResult(result);
          continue; // Skip to next iteration
        }
        
        // Use retry response
        metricsResp.metrics = retryResp.metrics;
        metricsResp.success = true;
      }
      
      // Check abort after reading metrics
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      const values = metricsResp.metrics;
      const metricValue = values[metric];
      
      // Check if target metric is null
      if (metricValue === null || metricValue === undefined) {
        await sendLog('error', `Failed to read target metric '${metric}'. Retrying...`);
        
        // Retry once after a delay
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const retryResp = await sendToContent('readAllMetrics', { metricNames });
        if (retryResp.success && retryResp.metrics[metric] !== null) {
          values[metric] = retryResp.metrics[metric];
          // Update other metrics too if they were null
          for (const key of Object.keys(values)) {
            if (values[key] === null && retryResp.metrics[key] !== null) {
              values[key] = retryResp.metrics[key];
            }
          }
          await sendLog('info', `Retry successful. ${metric}: ${values[metric]}`);
        } else {
          await sendLog('error', `Failed to read target metric '${metric}' after retry. Skipping iteration ${i}.`);
          
          // Skip this iteration but continue optimization
          const result = { 
            iteration: i, 
            settings: suggestedParams, 
            value: null, 
            metric, 
            isValid: false,
            isBest: false,
            error: 'Failed to read metrics'
          };
          
          allResults.push(result);
          await sendResult(result);
          continue; // Skip to next iteration
        }
      }
      
      // Register result with Bayesian optimizer
      try {
        const registrationResult = await registerOptimizationResult(currentSessionId, suggestedParams, values);
        const resultInfo = registrationResult.result_info || {};
        const isValid = resultInfo.is_valid;
        const isBest = resultInfo.is_best;
        
        // Check which filters failed
        if (!isValid) {
          // Log detailed filter failure information
          const filterFailures = [];
          for (const filter of filters) {
            const filterMetricValue = values[filter.metric];
            if (filterMetricValue !== null && filterMetricValue !== undefined) {
              if (filter.min !== null && filterMetricValue < filter.min) {
                filterFailures.push(`${filter.metric}=${filterMetricValue} < min=${filter.min}`);
              }
              if (filter.max !== null && filterMetricValue > filter.max) {
                filterFailures.push(`${filter.metric}=${filterMetricValue} > max=${filter.max}`);
              }
            }
          }
          if (filterFailures.length > 0) {
            await sendLog('info', `Result filtered out - Failed filters: ${filterFailures.join(', ')}`);
          }
        }
        
        if (isValid) {
          validResultsCount++;
          if (isBest) {
            bestResult = { 
              iteration: i, 
              settings: suggestedParams, 
              value: values[metric], 
              metric, 
              isValid: true 
            };
          }
        }
        
        // Emit result for UI
        const result = { 
          iteration: i, 
          settings: suggestedParams, 
          value: values[metric], 
          metric, 
          isValid, 
          isBest
        };
        
        allResults.push(result);
        await sendResult(result);
      } catch (error) {
        await sendLog('error', `Failed to register result: ${error.message}`);
        
        // Still emit result for UI even if registration failed
        const result = { 
          iteration: i, 
          settings: suggestedParams, 
          value: values[metric], 
          metric, 
          isValid: false,
          isBest: false,
          error: error.message
        };
        
        allResults.push(result);
        await sendResult(result);
      }
      
      // Memory management: keep only recent results in memory
      if (allResults.length > MAX_RESULTS_IN_MEMORY) {
        // Keep the best result and recent results
        const bestResultItem = allResults.find(r => r.isBest);
        const recentResults = allResults.slice(-MAX_RESULTS_IN_MEMORY);
        allResults = bestResultItem && !recentResults.includes(bestResultItem) 
          ? [bestResultItem, ...recentResults] 
          : recentResults;
      }
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
        // Abort signal sent
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
    // TradingView chart page loaded
  }
}); 