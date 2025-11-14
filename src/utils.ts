import type { StrategySettings, SavedOptimisationConfig, MessageRequest, MessageResponse } from './types';
import { STORAGE_KEYS, UI_TEXT } from './config';

// Browser-specific API access
// Build-time browser detection determines which API to use
declare const process: {
    env: {
        BROWSER: 'chrome' | 'firefox';
    };
};

// Declare browser globals - Firefox uses 'browser', Chrome uses 'chrome'
// Both implement the same WebExtensions API
declare const browser: typeof chrome;

// Use the appropriate browser API based on build target
const browserAPI = process.env.BROWSER === 'firefox' ? browser : chrome;

/**
 * Browser runtime API - works for both Chrome and Firefox
 */
export const runtime = browserAPI.runtime;

/**
 * Browser storage API - works for both Chrome and Firefox
 */
export const storage = browserAPI.storage;

/**
 * Browser tabs API - works for both Chrome and Firefox
 */
export const tabs = browserAPI.tabs;

/**
 * Send a message to the background script
 * @param message - The message to send
 * @returns Promise that resolves with the response
 */
export const sendMessage = (message: MessageRequest): Promise<MessageResponse> => {
    return new Promise((resolve, reject) => {
        try {
            runtime.sendMessage(message, (response: MessageResponse) => {
                runtime.lastError ? reject(runtime.lastError) : resolve(response);
            });
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Send message directly to the active tab's content script
 */
export const sendToActiveTab = async (message: MessageRequest): Promise<MessageResponse> => {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        throw new Error(UI_TEXT.errors.noActiveTab);
    }
    const tabId = tab.id; // Extract to ensure type narrowing
    return new Promise((resolve, reject) => {
        tabs.sendMessage(tabId, message, (response: MessageResponse) => {
            runtime.lastError ? reject(runtime.lastError) : resolve(response);
        });
    });
};

/**
 * Get items from browser storage
 * @param keys - Single key or array of keys to retrieve
 * @returns Promise that resolves with the stored data
 */
export const storageGet = (keys: string | string[]): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
        storage.local.get(keys, (result: Record<string, unknown>) =>
            runtime.lastError ? reject(runtime.lastError) : resolve(result)
        );
    });

/**
 * Set items in browser storage
 * @param items - Object containing key-value pairs to store
 * @returns Promise that resolves when storage is complete
 */
export const storageSet = (items: Record<string, unknown>): Promise<void> =>
    new Promise((resolve, reject) => {
        storage.local.set(items, () => (runtime.lastError ? reject(runtime.lastError) : resolve()));
    });

/**
 * Helper functions for common storage operations
 */
export const storageHelpers = {
    /**
     * Get strategies from storage
     * @throws Error if no strategies found
     */
    async getStrategies(): Promise<StrategySettings[]> {
        const result = await storageGet(STORAGE_KEYS.strategies);
        const strategies = result[STORAGE_KEYS.strategies];
        if (!Array.isArray(strategies)) {
            throw new Error(UI_TEXT.errors.noStrategies);
        }
        return strategies;
    },

    /**
     * Get saved optimisation configurations from storage
     * Initializes empty array if none exist
     */
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

    /**
     * Save strategies to storage
     * @param strategies - Array of strategy settings to save
     */
    async saveStrategies(strategies: StrategySettings[]): Promise<void> {
        await storageSet({ [STORAGE_KEYS.strategies]: strategies });
    },

    /**
     * Save optimisation configurations to storage
     * @param configs - Array of saved configurations
     */
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

/**
 * Generate a unique ID using timestamp and random string
 * @returns Unique identifier string
 */
export const generateId = (): string => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};
