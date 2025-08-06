import React, { useState, useEffect } from 'react';
import { OptimisationConfig, OptimisationParameter, SavedOptimisationConfig, StrategySettings } from '../../types';
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
}

type ParameterValue = string | number | boolean;

export const SetupTab: React.FC<SetupTabProps> = ({ onConfigChange }) => {
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
                console.error('Failed to load initial data:', error);
                setStrategies([]);
                setSavedConfigs([]);
            } finally {
                setIsLoading(false);
            }
        };
        initializeData();
    }, []);

    // Handler functions
    const refreshStrategies = async () => {
        console.log('Refreshing strategies...');
        setIsLoading(true);
        try {
            const strategiesData = await extractStrategiesFromTradingView();
            setStrategies(strategiesData);
            setSelectedStrategy('');
            setSelectedSavedConfig('');
            setOptimisationParams([]);
            onConfigChange(null);
        } catch (error) {
            console.error('Failed to refresh strategies:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveConfig = async (config: SavedOptimisationConfig) => {
        const updatedConfigs = [...savedConfigs, config];
        await storageHelpers.saveSavedConfigs(updatedConfigs);
        setSavedConfigs(updatedConfigs);
    };

    const deleteConfig = async (configId: string) => {
        const updatedConfigs = savedConfigs.filter(config => config.id !== configId);
        await storageHelpers.saveSavedConfigs(updatedConfigs);
        setSavedConfigs(updatedConfigs);
    };

    // Event handlers
    const handleStrategyChange = async (value: string) => {
        if (!value) {
            setSelectedStrategy('');
            onConfigChange(null);
            return;
        }

        setSelectedStrategy(value);
        setSelectedSavedConfig('');

        try {
            const strategyIndex = parseInt(value);
            const settings = await loadStrategySettings(strategyIndex);
            const params = createParametersFromSettings(settings);
            setOptimisationParams(params);

            if (selectedStrategyData) {
                onConfigChange({
                    strategyName: selectedStrategyData.name,
                    parameters: params,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Failed to load strategy settings:', error);
            onConfigChange(null);
        }
    };

    const handleSavedConfigChange = async (configId: string) => {
        if (!configId) {
            setSelectedSavedConfig('');
            return;
        }

        setSelectedSavedConfig(configId);

        if (!selectedStrategyData) {
            console.error('No strategy selected');
            return;
        }

        try {
            const config = savedConfigs.find(c => c.id === configId);

            if (!config) {
                throw new Error('Configuration not found');
            }

            const settings = await loadStrategySettings(selectedStrategyIndex, 'Reloading');
            const mergedParams = mergeParametersWithSavedConfig(settings, config.parameters);
            setOptimisationParams(mergedParams);

            onConfigChange({
                strategyName: selectedStrategyData.name,
                parameters: mergedParams,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to load saved configuration:', error);
        }
    };

    const handleParameterChange = (index: number, field: keyof OptimisationParameter, value: ParameterValue) => {
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
    };

    const handleLoadConfig = async () => {
        // This function is called by SavedConfigsCard
        // The actual loading is handled by handleSavedConfigChange
    };

    const handleDeleteConfig = async () => {
        if (!selectedSavedConfig) return;

        await deleteConfig(selectedSavedConfig);
        setSelectedSavedConfig('');
    };

    const handleSaveConfig = async () => {
        if (!configName.trim()) {
            console.error('Configuration name is required');
            return;
        }

        if (!selectedStrategyData) {
            console.error('No strategy selected');
            return;
        }

        const newConfig: SavedOptimisationConfig = {
            id: generateId(),
            name: configName.trim(),
            description: configDescription.trim() || '',
            strategyName: selectedStrategyData.name,
            parameters: optimisationParams,
            timestamp: new Date().toISOString()
        };

        await saveConfig(newConfig);
        setConfigName('');
        setConfigDescription('');
    };

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
                onLoadConfig={handleLoadConfig}
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
};
