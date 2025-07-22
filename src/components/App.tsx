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
        if (config) {
            updateStatus(
                `Configuration updated for ${config.strategyName} with ${config.parameters.length} parameters`,
                'success'
            );
        }
    };

    const handleStartOptimisation = async (settings: OptimisationSettings) => {
        if (!currentConfig) {
            updateStatus('No configuration available for optimisation', 'error');
            return;
        }

        setIsOptimising(true);
        setOptimisationResults([]);
        setBestResult(null);
        updateStatus(`Starting optimisation for ${currentConfig.strategyName}...`, 'info');

        try {
            // Here you would integrate with your existing optimisation logic
            // For now, we'll simulate some results
            await simulateOptimisation(settings, currentConfig);
        } catch (error) {
            updateStatus(`Optimisation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        } finally {
            setIsOptimising(false);
        }
    };

    const simulateOptimisation = async (settings: OptimisationSettings, config: OptimisationConfig) => {
        // TODO: Replace with actual Bayesian optimisation implementation
        const maxIterations = Math.min(settings.iterations, 10); // Limit simulation iterations

        for (let i = 1; i <= maxIterations; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing delay

            // Generate random parameters within specified ranges
            const parameters: Record<string, number> = {};
            config.parameters.forEach(param => {
                if (param.enabled) {
                    parameters[param.label] = Math.random() * (param.maxValue - param.minValue) + param.minValue;
                }
            });

            // Generate simulated metrics
            const metrics: Record<string, number> = {
                netProfit: Math.random() * 10000 - 5000,
                totalTrades: Math.floor(Math.random() * 100),
                profitFactor: Math.random() * 3,
                maxDrawdown: Math.random() * -1000,
                sharpeRatio: Math.random() * 2 - 1,
                winRate: Math.random() * 100
            };

            const result: OptimisationResult = {
                id: `result-${i}`,
                parameters,
                metrics,
                timestamp: new Date().toISOString(),
                iteration: i
            };

            setOptimisationResults(prev => {
                const newResults = [...prev, result];

                // Find best result based on selected metric
                const currentBest = newResults.reduce((best, current) => {
                    if (!best) return current;
                    return current.metrics[settings.metric] > best.metrics[settings.metric] ? current : best;
                });

                setBestResult(currentBest);
                return newResults;
            });

            updateStatus(`Optimisation progress: ${i}/${maxIterations} iterations completed`, 'info');
        }

        updateStatus('Optimisation simulation completed successfully!', 'success');
    };

    const handleApplyBest = () => {
        if (!bestResult) return;
        updateStatus('Best parameters applied to strategy', 'success');
        // TODO: Implement actual parameter application to TradingView strategy
    };

    const handleExportCSV = () => {
        if (!optimisationResults.length) {
            updateStatus('No results to export', 'warning');
            return;
        }

        // TODO: Implement actual CSV export functionality
        updateStatus('Results exported to CSV', 'success');
    };

    const handleExportJSON = () => {
        if (!optimisationResults.length) {
            updateStatus('No results to export', 'warning');
            return;
        }

        // TODO: Implement actual JSON export functionality
        updateStatus('Results exported to JSON', 'success');
    };

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'setup':
                return <SetupTab onConfigChange={handleConfigChange} />;
            case 'optimise':
                return <OptimiseTab config={currentConfig} onStartOptimisation={handleStartOptimisation} />;
            case 'results':
                return (
                    <ResultsTab
                        results={optimisationResults}
                        bestResult={bestResult}
                        isOptimising={isOptimising}
                        onApplyBest={handleApplyBest}
                        onExportCSV={handleExportCSV}
                        onExportJSON={handleExportJSON}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div
            className='min-h-screen'
            style={{ backgroundColor: 'var(--color-popup-bg)', color: 'var(--color-popup-text)' }}
        >
            <div className='mx-auto w-full max-w-2xl'>
                <header className='py-6 text-center' style={{ borderBottomColor: 'var(--color-popup-border)' }}>
                    <h1 className='text-2xl font-bold' style={{ color: 'var(--color-popup-text)' }}>
                        TradingView Strategy Optimiser
                    </h1>
                    <p className='mt-2' style={{ color: 'var(--color-popup-text-secondary)' }}>
                        Optimise strategy parameters using Bayesian optimisation
                    </p>
                </header>

                <TabNavigation tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

                <main className='p-6'>{renderActiveTab()}</main>

                <footer
                    className='py-4 text-center text-xs'
                    style={{ color: 'var(--color-popup-text-secondary)', borderTopColor: 'var(--color-popup-border)' }}
                >
                    TradingView Strategy Optimiser v1.0
                </footer>
            </div>
        </div>
    );
};
