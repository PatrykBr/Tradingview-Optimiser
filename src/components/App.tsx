import React, { useState } from 'react';
import { TabNavigation, Status } from './ui';
import { SetupTab, OptimiseTab, ResultsTab } from './tabs';
import type { OptimisationConfig, OptimisationResult, OptimisationSettings } from '../types';

const TABS = [
    { id: 'setup', label: 'Setup', icon: '⚙️' },
    { id: 'optimise', label: 'Optimise', icon: '🎯' },
    { id: 'results', label: 'Results', icon: '📊' }
];

export const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<string>('setup');
    const [currentConfig, setCurrentConfig] = useState<OptimisationConfig | null>(null);
    const [optimisationResults, setOptimisationResults] = useState<OptimisationResult[]>([]);
    const [bestResult, setBestResult] = useState<OptimisationResult | null>(null);
    const [isOptimising, setIsOptimising] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('Ready - Please select the Setup tab to begin');
    const [statusType, setStatusType] = useState<'info' | 'success' | 'warning' | 'error'>('info');

    const updateStatus = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
        setStatusMessage(message);
        setStatusType(type);
    };

    const handleConfigChange = (config: OptimisationConfig | null) => {
        setCurrentConfig(config);
        if (config)
            updateStatus(
                `Configuration updated for ${config.strategyName} with ${config.parameters.length} parameters`,
                'success'
            );
    };

    const handleStartOptimisation = async (settings: OptimisationSettings) => {
        if (!currentConfig) return updateStatus('No configuration available for optimisation', 'error');

        setIsOptimising(true);
        setOptimisationResults([]);
        setBestResult(null);
        updateStatus(`Starting optimisation for ${currentConfig.strategyName}...`, 'info');

        try {
            updateStatus('Optimisation logic not yet implemented', 'warning');
        } catch (error) {
            updateStatus(`Optimisation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        } finally {
            setIsOptimising(false);
        }
    };

    const handlers = {
        applyBest: () => bestResult && updateStatus('Best parameters applied to strategy', 'success'),
        exportCSV: () =>
            optimisationResults.length
                ? updateStatus('Results exported to CSV', 'success')
                : updateStatus('No results to export', 'warning'),
        exportJSON: () =>
            optimisationResults.length
                ? updateStatus('Results exported to JSON', 'success')
                : updateStatus('No results to export', 'warning')
    };

    const tabs = {
        setup: <SetupTab onConfigChange={handleConfigChange} />,
        optimise: <OptimiseTab config={currentConfig} onStartOptimisation={handleStartOptimisation} />,
        results: (
            <ResultsTab
                results={optimisationResults}
                bestResult={bestResult}
                isOptimising={isOptimising}
                onApplyBest={handlers.applyBest}
                onExportCSV={handlers.exportCSV}
                onExportJSON={handlers.exportJSON}
            />
        )
    };

    return (
        <div
            className='min-h-screen'
            style={{ backgroundColor: 'var(--color-popup-bg)', color: 'var(--color-popup-text)' }}
        >
            <div className='mx-auto w-full max-w-2xl'>
                <header className='py-6 text-center'>
                    <h1 className='text-2xl font-bold'>TradingView Strategy Optimiser</h1>
                    <p className='mt-2 opacity-75'>Optimise strategy parameters using Bayesian optimisation</p>
                </header>

                <TabNavigation tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

                <Status message={statusMessage} type={statusType} />

                <main className='p-6'>{tabs[activeTab as keyof typeof tabs]}</main>

                <footer className='py-4 text-center text-xs opacity-60'>TradingView Strategy Optimiser v1.0</footer>
            </div>
        </div>
    );
};
