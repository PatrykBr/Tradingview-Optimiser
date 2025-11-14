import { MESSAGES, STORAGE_KEYS } from './config';
import type { MessageRequest, MessageResponse } from './types';
import { runtime, storageSet } from './utils';

type StorageMapKey = keyof typeof STORAGE_MAP;
type DataProp = (typeof STORAGE_MAP)[StorageMapKey]['dataProp'];

// Map message actions to their storage keys and data property names
const STORAGE_MAP = {
    [MESSAGES.saveData]: { key: STORAGE_KEYS.extractedData, dataProp: 'data' as const },
    [MESSAGES.saveStrategies]: { key: STORAGE_KEYS.strategies, dataProp: 'strategies' as const },
    [MESSAGES.saveDateRangeSettings]: { key: STORAGE_KEYS.dateRangeSettings, dataProp: 'dateRangeSettings' as const },
    [MESSAGES.saveOptimisationConfig]: {
        key: STORAGE_KEYS.optimisationConfig,
        dataProp: 'optimisationConfig' as const
    },
    [MESSAGES.saveSavedOptimisationConfigs]: {
        key: STORAGE_KEYS.savedOptimisationConfigs,
        dataProp: 'savedOptimisationConfigs' as const
    }
} as const;

runtime.onMessage.addListener(
    (
        request: MessageRequest,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: MessageResponse) => void
    ): boolean => {
        if (!request?.action) {
            sendResponse({ success: false, error: 'Invalid request: missing action' });
            return true;
        }

        const mapping = STORAGE_MAP[request.action as StorageMapKey];

        if (!mapping) return false; // Let content script handle it

        const data = request[mapping.dataProp];
        if (!data) {
            sendResponse({ success: false, error: `Missing required data: ${mapping.dataProp}` });
            return true;
        }

        storageSet({ [mapping.key]: data })
            .then(() => sendResponse({ success: true }))
            .catch((error: unknown) => {
                const errorMessage = error instanceof Error ? error.message : 'Storage operation failed';
                sendResponse({ success: false, error: errorMessage });
            });

        return true;
    }
);
