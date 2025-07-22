import React from 'react';
import { Select, Input, Card } from '../ui';
import { AVAILABLE_METRICS } from '../../config';

interface OptimisationConfigProps {
    metric: string;
    iterations: number;
    onMetricChange: (metric: string) => void;
    onIterationsChange: (iterations: number) => void;
}

export const OptimisationConfigCard: React.FC<OptimisationConfigProps> = ({
    metric,
    iterations,
    onMetricChange,
    onIterationsChange
}) => {
    const metricOptions = [{ value: '', label: 'Select metric to optimise...' }, ...AVAILABLE_METRICS];

    return (
        <Card title='Optimisation Configuration'>
            <div className='space-y-4'>
                <Select
                    label='Optimisation Metric'
                    options={metricOptions}
                    value={metric}
                    onChange={e => onMetricChange(e.target.value)}
                />

                <Input
                    label='Number of Iterations'
                    type='number'
                    min={1}
                    max={1000}
                    value={iterations}
                    onChange={e => onIterationsChange(parseInt(e.target.value) || 100)}
                    placeholder='e.g., 100'
                />
            </div>
        </Card>
    );
};
