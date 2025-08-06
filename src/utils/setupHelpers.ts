import type { OptimisationParameter, StrategySettings } from '../types';
import { storageHelpers, sendToActiveTab } from '../utils';
import { MESSAGES } from '../config';

/**
 * Load strategies from storage
 */
export const loadStrategiesFromStorage = async (): Promise<StrategySettings[]> => {
    try {
        return await storageHelpers.getStrategies();
    } catch (error) {
        console.log('No strategies in storage, will need to extract from TradingView');
        return [];
    }
};

/**
 * Extract strategies from TradingView page
 */
export const extractStrategiesFromTradingView = async (): Promise<StrategySettings[]> => {
    try {
        const response = await sendToActiveTab({ action: MESSAGES.extractStrategies });
        if (response?.strategies) {
            console.log(`Extracted ${response.strategies.length} strategies from TradingView`);
            await storageHelpers.saveStrategies(response.strategies);
            return response.strategies;
        }
    } catch (error) {
        console.error('Failed to extract strategies from TradingView:', error);
    }
    return [];
};

/**
 * Load strategy settings for a specific strategy
 */
export const loadStrategySettings = async (
    strategyIndex: number,
    logPrefix = 'Loading'
): Promise<StrategySettings['settings']> => {
    console.log(`${logPrefix} strategy settings for strategy at index ${strategyIndex}`);
    const response = await sendToActiveTab({ action: MESSAGES.openStrategySettings, strategyIndex });

    if (!response.success) {
        throw new Error(response.error || response.message || 'Failed to extract strategy settings');
    }

    const strategy = response.strategies?.[0];
    if (!strategy?.settings) {
        throw new Error('No strategy settings found');
    }

    console.log('Strategy settings loaded successfully:', {
        strategyName: strategy.name,
        parameterCount: strategy.settings.length || 0
    });

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

    console.log(
        `Merging ${allStrategySettings.length} strategy parameters with ${savedParameters.length} saved parameters`
    );

    // Create full parameter list from strategy settings
    const mergedParams = allStrategySettings.map(setting => {
        const savedParam = savedParamMap.get(setting.label);

        if (savedParam) {
            // Use saved configuration (enabled with custom min/max values)
            console.log(
                `Applying saved config for parameter "${setting.label}": enabled=${savedParam.enabled}, min=${savedParam.minValue}, max=${savedParam.maxValue}`
            );
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

    const enabledCount = mergedParams.filter(p => p.enabled).length;
    const strategyParamNames = new Set(allStrategySettings.map(s => s.label));
    const missingSavedParams = savedParameters.filter(p => !strategyParamNames.has(p.label));

    if (missingSavedParams.length > 0) {
        console.warn(
            `Warning: ${missingSavedParams.length} saved parameters not found in current strategy:`,
            missingSavedParams.map(p => p.label)
        );
    }

    console.log(`Merge complete: ${mergedParams.length} total parameters, ${enabledCount} enabled`);

    return mergedParams;
};

/**
 * Finds strategy index by name
 */
export const findStrategyIndex = (strategies: StrategySettings[], strategyName: string): number =>
    strategies.findIndex(s => s.name === strategyName);

/**
 * Creates configuration object
 */
export const createConfig = (strategyName: string, parameters: OptimisationParameter[]) => ({
    strategyName,
    parameters: parameters.filter(p => p.enabled),
    timestamp: new Date().toISOString()
});
