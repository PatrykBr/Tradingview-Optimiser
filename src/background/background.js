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
    const initPoints = Math.min(2, iterations);
    // Initialize microservice
    let resp = await fetch('http://localhost:8000/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pbounds: Object.fromEntries(parameters.filter(p => p.enabled).map(p => [p.name, [p.min, p.max]])), init_points: Math.min(2, iterations), n_iter: iterations })
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
      sendLog('info', `Iteration ${i}/${iterations}, params: ${JSON.stringify(currentParams)}`);
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
      // Emit result for UI
      const result = { iteration: i, settings: currentParams, value: metricValue, metric, isValid, isBest: false };
      sendResult(result);
      chrome.runtime.sendMessage({ action: 'optimizationProgress', iteration: i, totalIterations: iterations });
    }
    // Fetch best result
    if (!abortOptimization) {
      resp = await fetch('http://localhost:8000/best');
      data = await resp.json();
      const bestParams = data.params;
      const bestValue = data.target;
      sendLog('info', `Optimization complete! Best ${metric}: ${bestValue}`);
      sendLog('info', `Best settings: ${JSON.stringify(bestParams)}`);
      sendResult({ iteration: 'best', settings: bestParams, value: bestValue, metric, isValid: true, isBest: true });
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