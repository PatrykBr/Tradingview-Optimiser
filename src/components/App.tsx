import { useState, useCallback, useMemo } from 'react';
import { TabNavigation, Status } from './ui';
import { SetupTab, OptimiseTab, ResultsTab } from './tabs';
import type { OptimisationConfig, OptimisationResult, OptimisationSettings } from '../types';
import { useStatus } from '../hooks/useStatus';

const TABS = [
    { id: 'setup', label: 'Setup', icon: '⚙️' },
    { id: 'optimise', label: 'Optimise', icon: '🎯' },
    { id: 'results', label: 'Results', icon: '📊' }
] as const;

export function App() {
    const [activeTab, setActiveTab] = useState<string>('setup');
    const [currentConfig, setCurrentConfig] = useState<OptimisationConfig | null>(null);
    const [optimisationResults, setOptimisationResults] = useState<OptimisationResult[]>([]);
    const [bestResult, setBestResult] = useState<OptimisationResult | null>(null);
    const [isOptimising, setIsOptimising] = useState(false);
    const {
        message: statusMessage,
        type: statusType,
        updateStatus
    } = useStatus('Ready - Please select the Setup tab to begin');

    const handleConfigChange = useCallback(
        (config: OptimisationConfig | null) => {
            setCurrentConfig(config);
            if (config) {
                updateStatus(
                    `Configuration updated for ${config.strategyName} with ${config.parameters.length} parameters`,
                    'success'
                );
            }
        },
        [updateStatus]
    );

    const handleStartOptimisation = useCallback(
        async (settings: OptimisationSettings) => {
            if (!currentConfig) {
                updateStatus('No configuration available for optimisation', 'error');
                return;
            }

            setIsOptimising(true);
            setOptimisationResults([]);
            setBestResult(null);
            updateStatus(`Starting optimisation for ${currentConfig.strategyName}...`, 'info');

            try {
                // TODO: Implement optimisation via Python backend
                updateStatus('Connect to Python backend to start optimisation', 'warning');
            } catch (error) {
                updateStatus(
                    `Optimisation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    'error'
                );
            } finally {
                setIsOptimising(false);
            }
        },
        [currentConfig, updateStatus]
    );

    const handleApplyBest = useCallback(() => {
        if (!bestResult) {
            updateStatus('No best result available to apply', 'warning');
            return;
        }
        // TODO: Implement applying best parameters via content script
        updateStatus('Apply best parameters feature pending implementation', 'warning');
    }, [bestResult, updateStatus]);

    const handleExportCSV = useCallback(() => {
        if (optimisationResults.length === 0) {
            updateStatus('No results to export', 'warning');
            return;
        }
        // TODO: Implement CSV export
        updateStatus('CSV export feature pending implementation', 'warning');
    }, [optimisationResults.length, updateStatus]);

    const handleExportJSON = useCallback(() => {
        if (optimisationResults.length === 0) {
            updateStatus('No results to export', 'warning');
            return;
        }
        // TODO: Implement JSON export
        updateStatus('JSON export feature pending implementation', 'warning');
    }, [optimisationResults.length, updateStatus]);

    const tabs = useMemo(
        () => ({
            setup: <SetupTab onConfigChange={handleConfigChange} onStatusChange={updateStatus} />,
            optimise: (
                <OptimiseTab
                    config={currentConfig}
                    onStartOptimisation={handleStartOptimisation}
                    onStatusChange={updateStatus}
                />
            ),
            results: (
                <ResultsTab
                    results={optimisationResults}
                    bestResult={bestResult}
                    isOptimising={isOptimising}
                    onApplyBest={handleApplyBest}
                    onExportCSV={handleExportCSV}
                    onExportJSON={handleExportJSON}
                />
            )
        }),
        [
            handleConfigChange,
            updateStatus,
            currentConfig,
            handleStartOptimisation,
            optimisationResults,
            bestResult,
            isOptimising,
            handleApplyBest,
            handleExportCSV,
            handleExportJSON
        ]
    );

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
}
