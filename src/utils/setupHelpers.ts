import type { OptimisationParameter, StrategySettings } from '../types';
import { storageHelpers, sendToActiveTab } from '../utils';
import { MESSAGES, UI_TEXT } from '../config';

/**
 * Load strategies from storage
 * Returns empty array if no strategies found
 */
export const loadStrategiesFromStorage = async (): Promise<StrategySettings[]> => {
    try {
        return await storageHelpers.getStrategies();
    } catch {
        return [];
    }
};

/**
 * Extract strategies from TradingView page
 * Returns empty array if extraction fails
 */
export const extractStrategiesFromTradingView = async (): Promise<StrategySettings[]> => {
    try {
        const response = await sendToActiveTab({ action: MESSAGES.extractStrategies });
        if (response?.strategies) {
            await storageHelpers.saveStrategies(response.strategies);
            return response.strategies;
        }
    } catch {
        // Silently handle extraction failure
    }
    return [];
};

/**
 * Load strategy settings for a specific strategy
 * @throws Error if extraction fails or no settings found
 */
export const loadStrategySettings = async (strategyIndex: number): Promise<StrategySettings['settings']> => {
    const response = await sendToActiveTab({ action: MESSAGES.openStrategySettings, strategyIndex });

    if (!response.success) {
        throw new Error(response.error || response.message || 'Failed to extract strategy settings');
    }

    const strategy = response.strategies?.[0];
    if (!strategy?.settings) {
        throw new Error('No strategy settings found');
    }

    return strategy.settings;
};

/**
 * Creates OptimisationParameter objects from strategy settings
 */
export const createParametersFromSettings = (settings: StrategySettings['settings']): OptimisationParameter[] =>
    settings.map(setting => ({
        label: setting.label,
        currentValue: setting.value,
        minValue: 0,
        maxValue: 100,
        enabled: false,
        tooltip: setting.tooltip
    }));

/**
 * Merges saved configuration parameters with all available strategy parameters
 * This shows all strategy parameters but applies saved settings for enabled ones
 */
export const mergeParametersWithSavedConfig = (
    allStrategySettings: StrategySettings['settings'],
    savedParameters: OptimisationParameter[]
): OptimisationParameter[] => {
    // Create a map of saved parameters by label for quick lookup
    const savedParamMap = new Map<string, OptimisationParameter>();
    savedParameters.forEach(param => {
        savedParamMap.set(param.label, param);
    });

    // Create full parameter list from strategy settings
    const mergedParams = allStrategySettings.map(setting => {
        const savedParam = savedParamMap.get(setting.label);

        if (savedParam) {
            // Use saved configuration (enabled with custom min/max values)
            return {
                ...savedParam,
                currentValue: setting.value, // Always use current strategy value
                tooltip: setting.tooltip
            };
        } else {
            // Use default configuration (disabled)
            return {
                label: setting.label,
                currentValue: setting.value,
                minValue: 0,
                maxValue: 100,
                enabled: false,
                tooltip: setting.tooltip
            };
        }
    });

    return mergedParams;
};
