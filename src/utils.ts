import type { StrategySettings, SavedOptimisationConfig, MessageRequest, MessageResponse } from './types';
import { STORAGE_KEYS } from './config';

// Browser-specific API access
// Build-time browser detection determines which API to use
declare const process: {
    env: {
        BROWSER: 'chrome' | 'firefox';
    };
};

// Declare browser globals
declare const browser: typeof chrome;
declare const chrome: any;

// Use the appropriate browser API based on build target
const browserAPI = process.env.BROWSER === 'firefox' ? browser : chrome;

export const runtime = browserAPI.runtime;
export const storage = browserAPI.storage;
export const tabs = browserAPI.tabs;

export const sendMessage = (message: MessageRequest): Promise<MessageResponse> => {
    console.log('Sending message:', message);
    return new Promise((resolve, reject) => {
        try {
            runtime.sendMessage(message, (response: MessageResponse) => {
                console.log('Message response:', response);
                runtime.lastError ? reject(runtime.lastError) : resolve(response);
            });
        } catch (error) {
            console.error('Send message error:', error);
            reject(error);
        }
    });
};

/**
 * Send message directly to the active tab's content script
 */
export const sendToActiveTab = async (message: MessageRequest): Promise<MessageResponse> => {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    return new Promise((resolve, reject) => {
        tabs.sendMessage(tab.id!, message, (response: MessageResponse) => {
            runtime.lastError ? reject(runtime.lastError) : resolve(response);
        });
    });
};

export const storageGet = (keys: string | string[]): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
        storage.local.get(keys, (result: Record<string, unknown>) =>
            runtime.lastError ? reject(runtime.lastError) : resolve(result)
        );
    });

export const storageSet = (items: Record<string, any>): Promise<void> =>
    new Promise((resolve, reject) => {
        storage.local.set(items, () => (runtime.lastError ? reject(runtime.lastError) : resolve()));
    });

export const storageHelpers = {
    async getStrategies(): Promise<StrategySettings[]> {
        const result = await storageGet(STORAGE_KEYS.strategies);
        const strategies = result[STORAGE_KEYS.strategies];
        if (!Array.isArray(strategies)) {
            throw new Error('No strategies found in storage - please extract strategies first');
        }
        return strategies;
    },

    async getSavedConfigs(): Promise<SavedOptimisationConfig[]> {
        const result = await storageGet(STORAGE_KEYS.savedOptimisationConfigs);
        const configs = result[STORAGE_KEYS.savedOptimisationConfigs];
        if (!Array.isArray(configs)) {
            // Initialize empty array for saved configs if none exist
            await storageSet({ [STORAGE_KEYS.savedOptimisationConfigs]: [] });
            return [];
        }
        return configs;
    },

    async saveStrategies(strategies: StrategySettings[]): Promise<void> {
        await storageSet({ [STORAGE_KEYS.strategies]: strategies });
    },

    async saveSavedConfigs(configs: SavedOptimisationConfig[]): Promise<void> {
        await storageSet({ [STORAGE_KEYS.savedOptimisationConfigs]: configs });
    }
};

/**
 * Format a date to YYYY-MM-DD format for date inputs
 */
export const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Get default date range (today for end date, 1 year ago for start date)
 */
export const getDefaultDateRange = (): { startDate: string; endDate: string } => {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    return {
        startDate: formatDateForInput(oneYearAgo),
        endDate: formatDateForInput(today)
    };
};

export const generateId = (): string => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};
