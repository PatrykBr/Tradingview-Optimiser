import { useState, useEffect, useCallback } from 'react';
import type {
    OptimisationConfig,
    OptimisationParameter,
    SavedOptimisationConfig,
    StrategySettings,
    ParameterValue
} from '../../types';
import { LoadingSpinner } from '../ui';
import { StrategySelectionCard, SavedConfigsCard, OptimisationParametersCard, SaveNewConfigCard } from '../setup';
import {
    loadStrategiesFromStorage,
    extractStrategiesFromTradingView,
    loadStrategySettings,
    createParametersFromSettings,
    mergeParametersWithSavedConfig
} from '../../utils/setupHelpers';
import { storageHelpers, generateId } from '../../utils';

interface SetupTabProps {
    onConfigChange: (config: OptimisationConfig | null) => void;
    onStatusChange: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SetupTab({ onConfigChange, onStatusChange }: SetupTabProps) {
    // State management
    const [strategies, setStrategies] = useState<StrategySettings[]>([]);
    const [savedConfigs, setSavedConfigs] = useState<SavedOptimisationConfig[]>([]);
    const [optimisationParams, setOptimisationParams] = useState<OptimisationParameter[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // UI state
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [selectedSavedConfig, setSelectedSavedConfig] = useState('');
    const [configName, setConfigName] = useState('');
    const [configDescription, setConfigDescription] = useState('');

    // Computed values
    const selectedStrategyIndex = parseInt(selectedStrategy);
    const selectedStrategyData = Number.isNaN(selectedStrategyIndex) ? null : strategies[selectedStrategyIndex];
    const filteredSavedConfigs = selectedStrategyData
        ? savedConfigs.filter(config => config.strategyName === selectedStrategyData.name)
        : [];

    // Initialize data
    useEffect(() => {
        const initializeData = async () => {
            setIsLoading(true);
            try {
                const [strategiesData, configsData] = await Promise.all([
                    loadStrategiesFromStorage(),
                    storageHelpers.getSavedConfigs()
                ]);
                setStrategies(strategiesData);
                setSavedConfigs(configsData);
            } catch (error) {
                onStatusChange(
                    `Failed to load data: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    'error'
                );
                setStrategies([]);
                setSavedConfigs([]);
            } finally {
                setIsLoading(false);
            }
        };
        initializeData();
    }, []);

    // Handler functions
    const refreshStrategies = useCallback(async () => {
        onStatusChange('Extracting strategies from TradingView...', 'info');
        setIsLoading(true);
        try {
            const strategiesData = await extractStrategiesFromTradingView();
            setStrategies(strategiesData);
            setSelectedStrategy('');
            setSelectedSavedConfig('');
            setOptimisationParams([]);
            onConfigChange(null);
            onStatusChange(`Found ${strategiesData.length} strategies`, 'success');
        } catch (error) {
            onStatusChange(
                `Failed to extract strategies: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'error'
            );
        } finally {
            setIsLoading(false);
        }
    }, [onConfigChange, onStatusChange]);

    // Event handlers
    const handleStrategyChange = useCallback(
        async (value: string) => {
            setSelectedStrategy(value);
            setSelectedSavedConfig('');

            if (!value) {
                setOptimisationParams([]);
                onConfigChange(null);
                return;
            }

            try {
                const strategyIndex = parseInt(value, 10);
                if (isNaN(strategyIndex) || strategyIndex < 0 || strategyIndex >= strategies.length) {
                    throw new Error('Invalid strategy index');
                }

                const settings = await loadStrategySettings(strategyIndex);
                const params = createParametersFromSettings(settings);
                setOptimisationParams(params);

                const strategy = strategies[strategyIndex];
                onConfigChange({
                    strategyName: strategy.name,
                    parameters: params,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                onStatusChange(
                    `Failed to load strategy settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    'error'
                );
                setOptimisationParams([]);
                onConfigChange(null);
            }
        },
        [onConfigChange, strategies]
    );

    const handleSavedConfigChange = useCallback(
        async (configId: string) => {
            setSelectedSavedConfig(configId);

            if (!configId || !selectedStrategyData) {
                return;
            }

            try {
                const config = savedConfigs.find(c => c.id === configId);
                if (!config) {
                    throw new Error(`Configuration not found: ${configId}`);
                }

                const settings = await loadStrategySettings(selectedStrategyIndex);
                const mergedParams = mergeParametersWithSavedConfig(settings, config.parameters);
                setOptimisationParams(mergedParams);

                onConfigChange({
                    strategyName: selectedStrategyData.name,
                    parameters: mergedParams,
                    timestamp: new Date().toISOString()
                });
                onStatusChange(`Loaded configuration: ${config.name}`, 'success');
            } catch (error) {
                onStatusChange(
                    `Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    'error'
                );
                setOptimisationParams([]);
            }
        },
        [selectedStrategyData, savedConfigs, selectedStrategyIndex, onConfigChange]
    );

    const handleParameterChange = useCallback(
        (index: number, field: keyof OptimisationParameter, value: ParameterValue) => {
            const updatedParams = [...optimisationParams];
            updatedParams[index] = { ...updatedParams[index], [field]: value };
            setOptimisationParams(updatedParams);

            if (selectedStrategyData) {
                onConfigChange({
                    strategyName: selectedStrategyData.name,
                    parameters: updatedParams,
                    timestamp: new Date().toISOString()
                });
            }
        },
        [optimisationParams, selectedStrategyData, onConfigChange]
    );

    const handleDeleteConfig = useCallback(async () => {
        if (!selectedSavedConfig) {
            onStatusChange('No configuration selected to delete', 'warning');
            return;
        }

        try {
            const updatedConfigs = savedConfigs.filter(config => config.id !== selectedSavedConfig);
            await storageHelpers.saveSavedConfigs(updatedConfigs);
            setSavedConfigs(updatedConfigs);
            setSelectedSavedConfig('');
            onStatusChange('Configuration deleted successfully', 'success');
        } catch (error) {
            onStatusChange(
                `Failed to delete configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'error'
            );
        }
    }, [selectedSavedConfig, savedConfigs, onStatusChange]);

    const handleSaveConfig = useCallback(async () => {
        const trimmedName = configName.trim();
        if (!trimmedName) {
            onStatusChange('Configuration name is required', 'warning');
            return;
        }

        if (!selectedStrategyData) {
            onStatusChange('No strategy selected', 'warning');
            return;
        }

        if (optimisationParams.length === 0) {
            onStatusChange('No parameters to save', 'warning');
            return;
        }

        try {
            const newConfig: SavedOptimisationConfig = {
                id: generateId(),
                name: trimmedName,
                description: configDescription.trim(),
                strategyName: selectedStrategyData.name,
                parameters: optimisationParams,
                timestamp: new Date().toISOString()
            };

            const updatedConfigs = [...savedConfigs, newConfig];
            await storageHelpers.saveSavedConfigs(updatedConfigs);
            setSavedConfigs(updatedConfigs);
            setConfigName('');
            setConfigDescription('');
            onStatusChange(`Configuration "${trimmedName}" saved successfully`, 'success');
        } catch (error) {
            onStatusChange(
                `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'error'
            );
        }
    }, [configName, selectedStrategyData, configDescription, optimisationParams, savedConfigs, onStatusChange]);

    if (isLoading && strategies.length === 0) {
        return (
            <div className='flex min-h-[400px] items-center justify-center'>
                <LoadingSpinner size='lg' message='Loading strategies from storage...' />
            </div>
        );
    }

    return (
        <div className='space-y-6'>
            <StrategySelectionCard
                strategies={strategies}
                selectedStrategy={selectedStrategy}
                isLoading={isLoading}
                onStrategyChange={handleStrategyChange}
                onRefreshStrategies={refreshStrategies}
            />

            <SavedConfigsCard
                savedConfigs={filteredSavedConfigs}
                selectedSavedConfig={selectedSavedConfig}
                onSelectedConfigChange={handleSavedConfigChange}
                onDeleteConfig={handleDeleteConfig}
            />

            <OptimisationParametersCard parameters={optimisationParams} onParameterChange={handleParameterChange} />

            <SaveNewConfigCard
                configName={configName}
                configDescription={configDescription}
                hasSelectedStrategy={!!selectedStrategyData}
                onConfigNameChange={setConfigName}
                onConfigDescriptionChange={setConfigDescription}
                onSaveConfig={handleSaveConfig}
            />
        </div>
    );
}
