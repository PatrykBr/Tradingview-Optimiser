import React, { useState, useEffect } from 'react';
import { StrategySelectionCard, SavedConfigsCard, SaveNewConfigCard, OptimisationParametersCard } from '../setup';
import { useExtensionState } from '../../hooks/useExtensionState';
import type { StrategySettings, OptimisationConfig, OptimisationParameter, SavedOptimisationConfig } from '../../types';

interface SetupTabProps {
    onConfigChange: (config: OptimisationConfig | null) => void;
}

export const SetupTab: React.FC<SetupTabProps> = ({ onConfigChange }) => {
    const { strategies, savedConfigs, isLoading, loadStrategies, saveConfig, deleteConfig } = useExtensionState();

    const [selectedStrategy, setSelectedStrategy] = useState<string>('');
    const [selectedSavedConfig, setSelectedSavedConfig] = useState<string>('');
    const [configName, setConfigName] = useState<string>('');
    const [configDescription, setConfigDescription] = useState<string>('');
    const [optimisationParams, setOptimisationParams] = useState<OptimisationParameter[]>([]);

    const selectedStrategyData = strategies[parseInt(selectedStrategy)] || null;

    useEffect(() => {
        if (selectedStrategyData) {
            const params: OptimisationParameter[] = selectedStrategyData.settings.map(setting => ({
                label: setting.label,
                currentValue: setting.value,
                minValue: 0,
                maxValue: 100,
                enabled: false,
                tooltip: setting.tooltip
            }));
            setOptimisationParams(params);
        }
    }, [selectedStrategyData]);

    const handleParamChange = (index: number, field: keyof OptimisationParameter, value: any) => {
        const newParams = [...optimisationParams];
        newParams[index] = { ...newParams[index], [field]: value };
        setOptimisationParams(newParams);

        if (selectedStrategyData) {
            const config: OptimisationConfig = {
                strategyName: selectedStrategyData.name,
                parameters: newParams.filter(p => p.enabled),
                timestamp: new Date().toISOString()
            };
            onConfigChange(config);
        }
    };

    const handleRefreshStrategies = () => {
        loadStrategies();
    };

    const handleLoadConfig = () => {
        const config = savedConfigs.find(c => c.id === selectedSavedConfig);
        if (config) {
            const strategyIndex = strategies.findIndex(s => s.name === config.strategyName);
            if (strategyIndex >= 0) {
                setSelectedStrategy(strategyIndex.toString());
                setOptimisationParams(config.parameters);
                const optimConfig: OptimisationConfig = {
                    strategyName: config.strategyName,
                    parameters: config.parameters,
                    timestamp: config.timestamp
                };
                onConfigChange(optimConfig);
            }
        }
    };

    const handleDeleteConfig = async () => {
        if (selectedSavedConfig) {
            await deleteConfig(selectedSavedConfig);
            setSelectedSavedConfig('');
        }
    };

    const handleSaveConfig = async () => {
        if (!configName || !selectedStrategyData) return;

        const config: SavedOptimisationConfig = {
            id: Date.now().toString(),
            name: configName,
            strategyName: selectedStrategyData.name,
            parameters: optimisationParams.filter(p => p.enabled),
            timestamp: new Date().toISOString(),
            description: configDescription
        };

        await saveConfig(config);
        setConfigName('');
        setConfigDescription('');
    };

    return (
        <div className='space-y-6'>
            <StrategySelectionCard
                strategies={strategies}
                selectedStrategy={selectedStrategy}
                isLoading={isLoading}
                onStrategyChange={setSelectedStrategy}
                onRefreshStrategies={handleRefreshStrategies}
            />

            {selectedStrategyData && (
                <>
                    <SavedConfigsCard
                        savedConfigs={savedConfigs}
                        selectedSavedConfig={selectedSavedConfig}
                        onSelectedConfigChange={setSelectedSavedConfig}
                        onLoadConfig={handleLoadConfig}
                        onDeleteConfig={handleDeleteConfig}
                    />

                    <SaveNewConfigCard
                        configName={configName}
                        configDescription={configDescription}
                        hasSelectedStrategy={!!selectedStrategyData}
                        onConfigNameChange={setConfigName}
                        onConfigDescriptionChange={setConfigDescription}
                        onSaveConfig={handleSaveConfig}
                    />

                    <OptimisationParametersCard parameters={optimisationParams} onParameterChange={handleParamChange} />
                </>
            )}
        </div>
    );
};
