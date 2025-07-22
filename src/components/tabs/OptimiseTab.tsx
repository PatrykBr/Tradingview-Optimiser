import React, { useState } from 'react';
import { Button } from '../ui';
import {
    OptimisationConfigCard,
    DateRangeCard,
    AntiDetectionCard,
    ResultFiltersCard,
    CurrentConfigCard
} from '../optimise';
import type { OptimisationConfig, OptimisationSettings, Filter } from '../../types';

interface OptimiseTabProps {
    config: OptimisationConfig | null;
    onStartOptimisation: (settings: OptimisationSettings) => void;
}

export const OptimiseTab: React.FC<OptimiseTabProps> = ({ config, onStartOptimisation }) => {
    const [metric, setMetric] = useState<string>('netProfit');
    const [iterations, setIterations] = useState<number>(100);
    const [useCustomDateRange, setUseCustomDateRange] = useState<boolean>(false);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [minDelay, setMinDelay] = useState<number>(100);
    const [maxDelay, setMaxDelay] = useState<number>(500);
    const [filters, setFilters] = useState<Filter[]>([]);
    const [newFilterMetric, setNewFilterMetric] = useState<string>('');
    const [newFilterMin, setNewFilterMin] = useState<string>('');
    const [newFilterMax, setNewFilterMax] = useState<string>('');

    const handleAddFilter = () => {
        if (!newFilterMetric) return;

        const filter: Filter = {
            id: Date.now().toString(),
            metric: newFilterMetric,
            minValue: newFilterMin ? parseFloat(newFilterMin) : undefined,
            maxValue: newFilterMax ? parseFloat(newFilterMax) : undefined
        };

        setFilters([...filters, filter]);
        setNewFilterMetric('');
        setNewFilterMin('');
        setNewFilterMax('');
    };

    const handleRemoveFilter = (filterId: string) => {
        setFilters(filters.filter(f => f.id !== filterId));
    };

    const handleStartOptimisation = () => {
        if (!config || !metric) return;

        const settings: OptimisationSettings = {
            metric,
            iterations,
            useCustomDateRange,
            startDate: useCustomDateRange ? startDate : undefined,
            endDate: useCustomDateRange ? endDate : undefined,
            minDelay,
            maxDelay,
            filters: filters.map(f => ({
                metric: f.metric,
                minValue: f.minValue,
                maxValue: f.maxValue
            }))
        };

        onStartOptimisation(settings);
    };

    const isConfigValid = config && config.parameters.length > 0;
    const canStartOptimisation = isConfigValid && metric && iterations > 0;

    return (
        <div className='space-y-6'>
            {!isConfigValid && (
                <div className='bg-popup-warning bg-opacity-20 border-popup-warning rounded-lg border p-4'>
                    <p className='text-popup-warning font-medium'>
                        ⚠️ Please configure optimisation parameters in the Setup tab first.
                    </p>
                </div>
            )}

            <OptimisationConfigCard
                metric={metric}
                iterations={iterations}
                onMetricChange={setMetric}
                onIterationsChange={setIterations}
            />

            <DateRangeCard
                useCustomDateRange={useCustomDateRange}
                startDate={startDate}
                endDate={endDate}
                onToggleCustomRange={setUseCustomDateRange}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
            />

            <AntiDetectionCard
                minDelay={minDelay}
                maxDelay={maxDelay}
                onMinDelayChange={setMinDelay}
                onMaxDelayChange={setMaxDelay}
            />

            <ResultFiltersCard
                filters={filters}
                newFilterMetric={newFilterMetric}
                newFilterMin={newFilterMin}
                newFilterMax={newFilterMax}
                selectedMetric={metric}
                onNewFilterMetricChange={setNewFilterMetric}
                onNewFilterMinChange={setNewFilterMin}
                onNewFilterMaxChange={setNewFilterMax}
                onAddFilter={handleAddFilter}
                onRemoveFilter={handleRemoveFilter}
            />

            <div className='flex justify-center'>
                <Button
                    variant='primary'
                    size='lg'
                    onClick={handleStartOptimisation}
                    disabled={!canStartOptimisation}
                    className='w-full max-w-sm'
                >
                    🚀 Start Optimisation
                </Button>
            </div>

            {config && <CurrentConfigCard config={config} />}
        </div>
    );
};
