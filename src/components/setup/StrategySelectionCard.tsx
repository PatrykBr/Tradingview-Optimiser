import React from 'react';
import { Button, Select, Card } from '../ui';

interface StrategySelectionProps {
    strategies: Array<{ name: string }>;
    selectedStrategy: string;
    isLoading: boolean;
    onStrategyChange: (strategy: string) => void;
    onRefreshStrategies: () => void;
}

export const StrategySelectionCard: React.FC<StrategySelectionProps> = ({
    strategies,
    selectedStrategy,
    isLoading,
    onStrategyChange,
    onRefreshStrategies
}) => {
    const strategyOptions = [
        { value: '', label: isLoading ? 'Loading strategies...' : 'Select a strategy...' },
        ...strategies.map((strategy, index) => ({
            value: index.toString(),
            label: strategy.name
        }))
    ];

    return (
        <Card title='Strategy Selection'>
            <div className='flex gap-2'>
                <div className='flex-1'>
                    <Select
                        options={strategyOptions}
                        value={selectedStrategy}
                        onChange={e => onStrategyChange(e.target.value)}
                        disabled={isLoading}
                    />
                </div>
                <Button variant='secondary' onClick={onRefreshStrategies} className='shrink-0'>
                    🔄
                </Button>
            </div>
        </Card>
    );
};
