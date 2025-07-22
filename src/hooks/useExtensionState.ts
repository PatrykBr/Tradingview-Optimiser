import { useState, useEffect } from 'react';
import { storageGet, storageSet } from '../utils';
import { STORAGE_KEYS } from '../config';
import type { StrategySettings, OptimisationConfig, SavedOptimisationConfig } from '../types';

interface ExtensionState {
    strategies: StrategySettings[];
    currentConfig: OptimisationConfig | null;
    savedConfigs: SavedOptimisationConfig[];
    isLoading: boolean;
    error: string | null;
}

export const useExtensionState = () => {
    const [state, setState] = useState<ExtensionState>({
        strategies: [],
        currentConfig: null,
        savedConfigs: [],
        isLoading: true,
        error: null
    });

    const updateState = (updates: Partial<ExtensionState>) => {
        setState(prev => ({ ...prev, ...updates }));
    };

    const loadStrategies = async () => {
        try {
            updateState({ isLoading: true, error: null });
            const result = await storageGet(STORAGE_KEYS.strategies);
            if (result && result[STORAGE_KEYS.strategies]) {
                updateState({ strategies: result[STORAGE_KEYS.strategies] });
            }
        } catch (error) {
            updateState({ error: error instanceof Error ? error.message : 'Failed to load strategies' });
        } finally {
            updateState({ isLoading: false });
        }
    };

    const loadSavedConfigs = async () => {
        try {
            const result = await storageGet(STORAGE_KEYS.savedOptimisationConfigs);
            if (result && result[STORAGE_KEYS.savedOptimisationConfigs]) {
                updateState({ savedConfigs: result[STORAGE_KEYS.savedOptimisationConfigs] });
            }
        } catch (error) {
            console.error('Failed to load saved configurations:', error);
        }
    };

    const saveConfig = async (config: SavedOptimisationConfig) => {
        try {
            const updatedConfigs = [...state.savedConfigs, config];
            await storageSet({ [STORAGE_KEYS.savedOptimisationConfigs]: updatedConfigs });
            updateState({ savedConfigs: updatedConfigs });
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to save configuration'
            };
        }
    };

    const deleteConfig = async (configId: string) => {
        try {
            const updatedConfigs = state.savedConfigs.filter(config => config.id !== configId);
            await storageSet({ [STORAGE_KEYS.savedOptimisationConfigs]: updatedConfigs });
            updateState({ savedConfigs: updatedConfigs });
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete configuration'
            };
        }
    };

    useEffect(() => {
        loadStrategies();
        loadSavedConfigs();
    }, []);

    return {
        ...state,
        updateState,
        loadStrategies,
        loadSavedConfigs,
        saveConfig,
        deleteConfig
    };
};
