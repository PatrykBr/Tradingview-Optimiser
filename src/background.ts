import { MESSAGES, STORAGE_KEYS } from './config';
import type {
    ExtractedItem,
    MessageRequest,
    MessageResponse,
    StrategySettings,
    DateRangeSettings,
    OptimisationConfig,
    SavedOptimisationConfig
} from './types';
import { runtime, storageSet } from './utils';

runtime.onMessage.addListener(
    (
        request: MessageRequest,
        _sender: chrome.runtime.MessageSender,
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
        } else if (request.action === MESSAGES.saveOptimisationConfig && request.optimisationConfig) {
            storageSet({ [STORAGE_KEYS.optimisationConfig]: request.optimisationConfig })
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch((error: unknown) => {
                    const errorMessage = error instanceof Error ? error.message : 'Storage error';
                    sendResponse({ success: false, error: errorMessage });
                });
            return true;
        } else if (request.action === MESSAGES.saveSavedOptimisationConfigs && request.savedOptimisationConfigs) {
            storageSet({ [STORAGE_KEYS.savedOptimisationConfigs]: request.savedOptimisationConfigs })
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch((error: unknown) => {
                    const errorMessage = error instanceof Error ? error.message : 'Storage error';
                    sendResponse({ success: false, error: errorMessage });
                });
            return true;
        }

        return false; // Don't respond to other messages - let them go to content script
    }
);
