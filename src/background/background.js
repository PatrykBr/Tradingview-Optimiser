// Background service worker for TradingView Strategy Optimizer

// Optimization state
let optimizer = null;
let abortOptimization = false;

// Helper: send log messages to popup UI
function sendLog(level, message) {
  console.log(`[BG] ${level.toUpperCase()} ${message}`);
  chrome.runtime.sendMessage({ action: 'optimizationLog', level, message });
}

// Helper: send individual result to popup UI
function sendResult(result) {
  chrome.runtime.sendMessage({ action: 'optimizationResult', result });
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
  try {
    sendLog('info', 'Starting optimization via Python microservice...');
    await chrome.storage.local.set({ antiDetection });
    if (deepBacktest) {
      sendLog('debug', 'Enabling deep backtest...');
      await sendToContent('toggleDeepBacktest', { enabled: true });
      if (startDate || endDate) {
        sendLog('debug', `Setting date range: ${startDate} to ${endDate}`);
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
    
    sendLog('info', `Using advanced Bayesian optimization: ${initPoints} exploration + ${optimizationSettings.n_iter} Bayesian iterations`);
    
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
        sendLog('info', 'Optimization stopped by user');
        break;
      }
      
      // Log iteration details with acquisition info
      const logMsg = `Iteration ${i}/${iterations}, params: ${JSON.stringify(currentParams)}`;
      if (data.acquisition_value !== undefined && data.acquisition_value > 0) {
        sendLog('info', `${logMsg} (acquisition: ${data.acquisition_value.toFixed(4)})`);
      } else {
        sendLog('info', `${logMsg} (exploration phase)`);
      }
      
      // Apply new settings
      const settingsToApply = enabledParams.map(p => ({ name: p.name, type: p.type, value: currentParams[p.name] }));
      await sendToContent('applySettings', { strategyIndex, settings: settingsToApply });
      if (deepBacktest) {
        sendLog('debug', 'Generating deep backtest report...');
        await sendToContent('setDateRange', { startDate, endDate });
      } else {
        sendLog('debug', 'Waiting for backtest to complete...');
        await sendToContent('waitForBacktestComplete');
      }
      sendLog('debug', 'Reading metrics...');
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
        sendLog('debug', `Confidence interval for next params: [${lower.toFixed(3)}, ${upper.toFixed(3)}]`);
      }
      
      // Emit result for UI
      const result = { 
        iteration: i, 
        settings: currentParams, 
        value: metricValue, 
        metric, 
        isValid, 
        isBest: false,
        acquisition_value: data.acquisition_value,
        confidence_interval: data.confidence_interval
      };
      sendResult(result);
      chrome.runtime.sendMessage({ action: 'optimizationProgress', iteration: i, totalIterations: iterations });
      
      // Periodically get optimization status for debugging
      if (i % 5 === 0) {
        try {
          const statusResp = await fetch('http://localhost:8000/status');
          if (statusResp.ok) {
            const status = await statusResp.json();
            sendLog('debug', `Optimization status - exploration ratio: ${status.current_exploration_ratio.toFixed(3)}, GP score: ${status.gp_score?.toFixed(3) || 'N/A'}`);
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
      
      sendLog('info', `Optimization complete! Best ${metric}: ${bestValue}`);
      sendLog('info', `Best settings: ${JSON.stringify(bestParams)}`);
      
      if (data.confidence_interval) {
        const [lower, upper] = data.confidence_interval;
        sendLog('info', `Confidence interval for best result: [${lower.toFixed(3)}, ${upper.toFixed(3)}]`);
      }
      
      // Get final optimization statistics
      try {
        const historyResp = await fetch('http://localhost:8000/history');
        if (historyResp.ok) {
          const history = await historyResp.json();
          sendLog('info', `Total observations: ${history.total_observations}, Best found at iteration: ${history.best_iteration}`);
        }
      } catch (e) {
        // History is optional
      }
      
      sendResult({ 
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
    sendLog('error', `Optimization error: ${error.message}`);
  } finally {
    if (deepBacktest) {
      await sendToContent('toggleDeepBacktest', { enabled: false });
    }
    abortOptimization = false;
    chrome.runtime.sendMessage({ action: 'optimizationCompleted' });
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
      sendResponse({ success: true });
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

// Handle tab updates to check if content script needs injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('tradingview.com/chart')) {
    console.log('TradingView chart page loaded');
  }
}); 