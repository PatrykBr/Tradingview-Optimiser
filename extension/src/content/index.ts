/**
 * Content Script - TradingView DOM Interaction
 *
 * Injected into TradingView pages. Handles:
 * - Parameter detection from the strategy settings dialog
 * - Parameter injection (setting values)
 * - Result scraping from the performance summary
 * - Anti-detection delays
 */

import type { ContentScriptCommand, ContentScriptResponse } from '../shared/messages';
import { detectParameters, listStrategies } from './detector';
import { injectParameters } from './injector';
import { scrapeResults } from './scraper';
import { isChartPage } from './selectors';

if (!isChartPage()) {
  console.log('[TVO] Content script loaded but not on a chart page — dormant');
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener(
  (message: ContentScriptCommand, _sender, sendResponse: (response: ContentScriptResponse) => void) => {
    const chartPage = isChartPage();

    // Allow PING on any page so the service worker can check if content script is loaded
    if (!chartPage && message.type !== 'PING') {
      sendResponse({
        type: 'ERROR',
        error: 'Content script is not on a TradingView chart page',
      });
      return true;
    }

    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          type: 'ERROR',
          error: err instanceof Error ? err.message : 'Unknown content script error',
        });
      });

    // Return true to indicate async response
    return true;
  },
);

async function handleMessage(msg: ContentScriptCommand): Promise<ContentScriptResponse> {
  switch (msg.type) {
    case 'PING':
      return { type: 'PONG' };

    case 'LIST_STRATEGIES':
      return listStrategies();

    case 'DETECT_PARAMS':
      return await detectParameters(msg.strategyIndex);

    case 'INJECT_PARAMS':
      return await injectParameters(msg.params, msg.antiDetection, msg.strategyIndex);

    case 'SCRAPE_RESULTS':
      return await scrapeResults();

    // M7: APPLY_PARAMS removed — it was a redundant duplicate of INJECT_PARAMS.
    // The service worker now uses INJECT_PARAMS for both trial injection and applying best params.

    default:
      return assertNever(msg);
  }
}

function assertNever(_value: never): ContentScriptResponse {
  return { type: 'ERROR', error: 'Unknown command' };
}

console.log('[TVO] Content script loaded on TradingView');
