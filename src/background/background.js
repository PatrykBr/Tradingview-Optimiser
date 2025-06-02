import BayesianOptimizer from '../services/bayesianOptimizer';

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
  optimizer = null;
  try {
    sendLog('info', 'Starting optimization...');
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
    // Prepare for exhaustive search if iterations cover all combinations
    const maxCombinations = calculateMaxCombinations(enabledParams);
    optimizer = new BayesianOptimizer(enabledParams);
    if (iterations >= maxCombinations) {
      sendLog('info', `Iterations (${iterations}) >= total combinations (${maxCombinations}), using exhaustive search`);
      const combos = generateCombinations(enabledParams);
      for (let i = 0; i < combos.length; i++) {
        if (abortOptimization) {
          sendLog('info', 'Optimization stopped by user');
          break;
        }
        sendLog('info', `Running iteration ${i+1}/${combos.length} (exhaustive)`);
        const sample = combos[i];
        const settingsToApply = enabledParams.map(param => ({ name: param.name, type: param.type, value: sample[param.name] }));
        await sendToContent('applySettings', { strategyIndex, settings: settingsToApply });
        if (deepBacktest) {
          sendLog('debug', 'Generating deep backtest report...');
          await sendToContent('setDateRange', { startDate, endDate });
        } else {
          sendLog('debug', 'Waiting for backtest to complete...');
          await sendToContent('waitForBacktestComplete');
        }
        sendLog('debug', 'Reading metrics...');
        const metricsToRead = [metric, ...filters.map(f => f.metric)];
        const uniqueMetrics = [...new Set(metricsToRead)];
        const metricsResp = await sendToContent('readAllMetrics', { metricNames: uniqueMetrics });
        if (!metricsResp.success) throw new Error('Failed to read metrics');
        const metricValue = metricsResp.metrics[metric];
        const isValid = filters.every(f => {
          const v = metricsResp.metrics[f.metric];
          return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
        });
        optimizer.addObservation(sample, metricValue, isValid);
        const progressData = optimizer.getProgress();
        const isBest = progressData.bestSample && JSON.stringify(progressData.bestSample) === JSON.stringify(sample);
        sendResult({ iteration: i+1, settings: sample, value: metricValue, metric, isValid, isBest });
        sendLog('info', `Iteration ${i+1}: ${metric} = ${metricValue} ${isValid ? '(Valid)' : '(Filtered)'}'`);
        chrome.runtime.sendMessage({ action: 'optimizationProgress', iteration: i+1, totalIterations: combos.length });
      }
      return;
    }
    const initialSamples = await optimizer.getInitialSamples();
    for (let i = 0; i < iterations; i++) {
      if (abortOptimization) {
        sendLog('info', 'Optimization stopped by user');
        break;
      }
      sendLog('info', `Running iteration ${i+1}/${iterations}`);
      const sample = i < initialSamples.length ? initialSamples[i] : await optimizer.getNextSample();
      sendLog('debug', `Applying settings: ${JSON.stringify(sample)}`);
      const settingsToApply = enabledParams.map(param => ({ name: param.name, type: param.type, value: sample[param.name] }));
      await sendToContent('applySettings', { strategyIndex, settings: settingsToApply });
      if (deepBacktest) {
        sendLog('debug', 'Generating deep backtest report...');
        await sendToContent('setDateRange', { startDate, endDate });
      } else {
        sendLog('debug', 'Waiting for backtest to complete...');
        await sendToContent('waitForBacktestComplete');
      }
      sendLog('debug', 'Reading metrics...');
      const metricsToRead = [metric, ...filters.map(f => f.metric)];
      const uniqueMetrics = [...new Set(metricsToRead)];
      const metricsResp = await sendToContent('readAllMetrics', { metricNames: uniqueMetrics });
      if (!metricsResp.success) throw new Error('Failed to read metrics');
      const metricValue = metricsResp.metrics[metric];
      const isValid = filters.every(f => {
        const v = metricsResp.metrics[f.metric];
        return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
      });
      optimizer.addObservation(sample, metricValue, isValid);
      const result = { iteration: i+1, settings: sample, value: metricValue, metric, isValid, isBest: false };
      const progress = optimizer.getProgress();
      if (progress.bestSample && JSON.stringify(progress.bestSample) === JSON.stringify(sample)) {
        result.isBest = true;
      }
      sendResult(result);
      sendLog('info', `Iteration ${i+1}: ${metric} = ${metricValue} ${isValid ? '(Valid)' : '(Filtered)'}`);
      // Send progress update
      chrome.runtime.sendMessage({ action: 'optimizationProgress', iteration: i+1, totalIterations: iterations });
    }
    const final = optimizer.getProgress();
    if (final.bestValue != null) {
      sendLog('info', `Optimization complete! Best ${metric}: ${final.bestValue}`);
      sendLog('info', `Best settings: ${JSON.stringify(final.bestSample)}`);
    } else {
      sendLog('warning', 'No valid results found');
    }
  } catch (error) {
    sendLog('error', `Optimization error: ${error.message}`);
  } finally {
    if (deepBacktest) {
      await sendToContent('toggleDeepBacktest', { enabled: false });
    }
    optimizer = null;
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