import React, { useState, useEffect } from 'react';
import { Button } from '../ui';
import {
    OptimisationConfigCard,
    DateRangeCard,
    AntiDetectionCard,
    ResultFiltersCard,
    CurrentConfigCard
} from '../optimise';
import { getDefaultDateRange, sendToActiveTab } from '../../utils';
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

    // Send date range update to TradingView
    const updateDateRange = (enabled: boolean, start = '', end = '') => {
        sendToActiveTab({
            action: 'changeDateRange',
            dateRangeSettings: {
                enabled,
                startDate: start,
                endDate: end,
                timestamp: new Date().toISOString()
            }
        }).catch(console.error);
    };

    // Handle custom date range toggle
    const handleToggleCustomRange = (enabled: boolean) => {
        setUseCustomDateRange(enabled);

        if (enabled && (!startDate || !endDate)) {
            const defaultDates = getDefaultDateRange();
            setStartDate(defaultDates.startDate);
            setEndDate(defaultDates.endDate);
            updateDateRange(true, defaultDates.startDate, defaultDates.endDate);
        } else if (enabled) {
            updateDateRange(true, startDate, endDate);
        } else {
            updateDateRange(false);
        }
    };

    // Handle date changes (only on blur)
    const handleStartDateBlur = (newStartDate: string) => {
        if (useCustomDateRange && newStartDate && endDate) {
            updateDateRange(true, newStartDate, endDate);
        }
    };

    const handleEndDateBlur = (newEndDate: string) => {
        if (useCustomDateRange && startDate && newEndDate) {
            updateDateRange(true, startDate, newEndDate);
        }
    };

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
                onToggleCustomRange={handleToggleCustomRange}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onStartDateBlur={handleStartDateBlur}
                onEndDateBlur={handleEndDateBlur}
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
