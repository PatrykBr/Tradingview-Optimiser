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

// Core optimization loop
async function runOptimization(settings) {
  const { metric, iterations, deepBacktest, startDate, endDate, antiDetection, parameters, filters, strategyIndex = 0 } = settings;
  abortOptimization = false;
  
  // Update state and clear previous results
  updateOptimizationState('running');
  await saveToStorage(STORAGE_KEYS.settings, settings);
  await saveToStorage(STORAGE_KEYS.filters, filters);
  await saveToStorage(STORAGE_KEYS.results, []);
  await saveToStorage(STORAGE_KEYS.logs, []);
  updateProgress(0, iterations);
  
  try {
    await sendLog('info', 'Starting optimization via Python microservice...');
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
    // Build parameter bounds for microservice
    const pbounds = {};
    enabledParams.forEach(p => { pbounds[p.name] = [p.min, p.max]; });
    
    // Advanced optimization settings
    const initPoints = Math.max(2, Math.min(5, Math.floor(iterations * 0.2))); // 20% for exploration, min 2, max 5
    const optimizationSettings = {
      pbounds: Object.fromEntries(parameters.filter(p => p.enabled).map(p => [p.name, [p.min, p.max]])),
      init_points: initPoints,
      n_iter: iterations - initPoints, // Remaining iterations for Bayesian optimization
      acquisition_type: "ucb", // Upper Confidence Bound for balanced exploration/exploitation
      kappa: 2.576, // Higher kappa for more exploration when parameters are discrete
      xi: 0.01, // Small xi for Expected Improvement
      alpha: enabledParams.some(p => p.type === 'checkbox') ? 1e-3 : 1e-6, // Higher noise for discrete params
      n_restarts_optimizer: 5, // More restarts for better GP optimization
      kernel_type: "matern" // Matern kernel typically works well for optimization
    };
    
    await sendLog('info', `Using advanced Bayesian optimization: ${initPoints} exploration + ${optimizationSettings.n_iter} Bayesian iterations`);
    
    // Initialize microservice with advanced settings
    let resp = await fetch('http://localhost:8000/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(optimizationSettings)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Init failed: ${resp.statusText}`);
    }
    let data = await resp.json();
    if (data.params === undefined) {
      throw new Error(`Init returned no params: ${JSON.stringify(data)}`);
    }
    let currentParams = data.params;
    let done = data.done;
    for (let i = 1; !done && i <= iterations; i++) {
      if (abortOptimization) {
        await sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      // Update progress
      updateProgress(i, iterations);
      
      // Log iteration details with acquisition info
      const logMsg = `Iteration ${i}/${iterations}, params: ${JSON.stringify(currentParams)}`;
      if (data.acquisition_value !== undefined && data.acquisition_value > 0) {
        await sendLog('info', `${logMsg} (acquisition: ${data.acquisition_value.toFixed(4)})`);
      } else {
        await sendLog('info', `${logMsg} (exploration phase)`);
      }
      
      // Store the current params used for this iteration
      const iterationParams = { ...currentParams };
      
      // Apply new settings
      const settingsToApply = enabledParams.map(p => ({ name: p.name, type: p.type, value: currentParams[p.name] }));
      await sendToContent('applySettings', { strategyIndex, settings: settingsToApply });
      if (deepBacktest) {
        await sendLog('debug', 'Generating deep backtest report...');
        await sendToContent('setDateRange', { startDate, endDate });
      } else {
        await sendLog('debug', 'Waiting for backtest to complete...');
        await sendToContent('waitForBacktestComplete');
      }
      await sendLog('debug', 'Reading metrics...');
      const metricNames = [...new Set([metric, ...filters.map(f => f.metric)])];
      const metricsResp = await sendToContent('readAllMetrics', { metricNames });
      if (!metricsResp.success) throw new Error('Failed to read metrics');
      const values = metricsResp.metrics;
      const metricValue = values[metric];
      const isValid = filters.every(f => {
        const v = values[f.metric];
        return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
      });
      // Observe back to microservice
      resp = await fetch('http://localhost:8000/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: currentParams, target: metricValue })
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.detail || resp.statusText);
      }
      data = await resp.json();
      if (data.params === undefined) {
        throw new Error(`No parameters returned from microservice: ${JSON.stringify(data)}`);
      }
      done = data.done;
      currentParams = data.params;
      
      // Log confidence interval if available
      if (data.confidence_interval) {
        const [lower, upper] = data.confidence_interval;
        await sendLog('debug', `Confidence interval for next params: [${lower.toFixed(3)}, ${upper.toFixed(3)}]`);
      }
      
      // Emit result for UI - use the params that were actually tested, not the next ones
      const result = { 
        iteration: i, 
        settings: iterationParams, 
        value: metricValue, 
        metric, 
        isValid, 
        isBest: false,
        acquisition_value: data.acquisition_value,
        confidence_interval: data.confidence_interval
      };
      await sendResult(result);
      
      // Periodically get optimization status for debugging
      if (i % 5 === 0) {
        try {
          const statusResp = await fetch('http://localhost:8000/status');
          if (statusResp.ok) {
            const status = await statusResp.json();
            await sendLog('debug', `Optimization status - exploration ratio: ${status.current_exploration_ratio.toFixed(3)}, GP score: ${status.gp_score?.toFixed(3) || 'N/A'}`);
          }
        } catch (e) {
          // Status check is optional, don't fail on it
        }
      }
    }
    // Fetch best result
    if (!abortOptimization) {
      resp = await fetch('http://localhost:8000/best');
      data = await resp.json();
      const bestParams = data.params;
      const bestValue = data.target;
      
      await sendLog('info', `Optimization complete! Best ${metric}: ${bestValue}`);
      await sendLog('info', `Best settings: ${JSON.stringify(bestParams)}`);
      
      if (data.confidence_interval) {
        const [lower, upper] = data.confidence_interval;
        await sendLog('info', `Confidence interval for best result: [${lower.toFixed(3)}, ${upper.toFixed(3)}]`);
      }
      
      // Get final optimization statistics
      try {
        const historyResp = await fetch('http://localhost:8000/history');
        if (historyResp.ok) {
          const history = await historyResp.json();
          await sendLog('info', `Total observations: ${history.total_observations}, Best found at iteration: ${history.best_iteration}`);
        }
      } catch (e) {
        // History is optional
      }
      
      await sendResult({ 
        iteration: 'best', 
        settings: bestParams, 
        value: bestValue, 
        metric, 
        isValid: true, 
        isBest: true,
        confidence_interval: data.confidence_interval
      });
    }
  } catch (error) {
    await sendLog('error', `Optimization error: ${error.message}`);
  } finally {
    if (deepBacktest) {
      await sendToContent('syncDeepBacktest', { enabled: false });
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
      updateOptimizationState('stopped');
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
    case 'injectContentScript':
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      });
      return true;
    case 'forwardToContent':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, request.data, (response) => {
          sendResponse(response);
        });
      });
      return true;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('TradingView Strategy Optimizer installed');
  chrome.storage.local.set({
    favoriteMetrics: ['netProfit', 'sharpeRatio', 'winRate'],
    antiDetection: { minDelay: 500, maxDelay: 2000 },
    logLevel: 'basic'
  });
});

// On startup, check if there was an ongoing optimization and restore state
chrome.runtime.onStartup.addListener(async () => {
  const state = await loadFromStorage(STORAGE_KEYS.state);
  if (state) {
    currentOptimizationState = state;
  }
});

// Handle tab updates to check if content script needs injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('tradingview.com/chart')) {
    console.log('TradingView chart page loaded');
  }
}); 