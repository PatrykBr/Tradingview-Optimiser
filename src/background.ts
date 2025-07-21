import { MESSAGES, STORAGE_KEYS } from './config';
import type { ExtractedItem, MessageRequest, MessageResponse, StrategySettings, DateRangeSettings } from './types';
import { runtime, storageSet } from './utils';

runtime.onMessage.addListener((
  request: MessageRequest, 
  sender: any, 
  sendResponse: (response: MessageResponse) => void
): boolean | void => {
  if (request.action === MESSAGES.saveData && request.data) {
    storageSet({ [STORAGE_KEYS.extractedData]: request.data })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Storage error';
        sendResponse({ success: false, error: errorMessage });
      });
    return true;
  } else if (request.action === MESSAGES.saveStrategies && request.strategies) {
    storageSet({ [STORAGE_KEYS.strategies]: request.strategies })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Storage error';
        sendResponse({ success: false, error: errorMessage });
      });
    return true;
  } else if (request.action === MESSAGES.saveDateRangeSettings && request.dateRangeSettings) {
    storageSet({ [STORAGE_KEYS.dateRangeSettings]: request.dateRangeSettings })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Storage error';
        sendResponse({ success: false, error: errorMessage });
      });
    return true;
  } else {
    sendResponse({ success: false, error: 'Invalid action or missing data' });
  }
});
