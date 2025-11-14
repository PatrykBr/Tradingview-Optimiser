import { useState, useCallback } from 'react';
import { Button } from '../ui';
import {
    OptimisationConfigCard,
    DateRangeCard,
    AntiDetectionCard,
    ResultFiltersCard,
    CurrentConfigCard
} from '../optimise';
import { getDefaultDateRange, sendToActiveTab, generateId } from '../../utils';
import { isValidDateRange } from '../../utils/validation';
import type { OptimisationConfig, OptimisationSettings, Filter } from '../../types';

interface OptimiseTabProps {
    config: OptimisationConfig | null;
    onStartOptimisation: (settings: OptimisationSettings) => void;
    onStatusChange: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export function OptimiseTab({ config, onStartOptimisation, onStatusChange }: OptimiseTabProps) {
    const [metric, setMetric] = useState('netProfit');
    const [iterations, setIterations] = useState(100);
    const [useCustomDateRange, setUseCustomDateRange] = useState(false);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [minDelay, setMinDelay] = useState(100);
    const [maxDelay, setMaxDelay] = useState(500);
    const [filters, setFilters] = useState<Filter[]>([]);
    const [newFilterMetric, setNewFilterMetric] = useState('');
    const [newFilterMin, setNewFilterMin] = useState('');
    const [newFilterMax, setNewFilterMax] = useState('');

    // Send date range update to TradingView
    const updateDateRange = useCallback(
        (enabled: boolean, start = '', end = '') => {
            sendToActiveTab({
                action: 'changeDateRange',
                dateRangeSettings: {
                    enabled,
                    startDate: start,
                    endDate: end,
                    timestamp: new Date().toISOString()
                }
            }).catch(error => {
                onStatusChange(
                    `Failed to update date range: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    'error'
                );
            });
        },
        [onStatusChange]
    );

    // Handle custom date range toggle
    const handleToggleCustomRange = useCallback(
        (enabled: boolean) => {
            setUseCustomDateRange(enabled);

            if (!enabled) {
                updateDateRange(false);
                return;
            }

            if (!startDate || !endDate) {
                const defaultDates = getDefaultDateRange();
                setStartDate(defaultDates.startDate);
                setEndDate(defaultDates.endDate);
                updateDateRange(true, defaultDates.startDate, defaultDates.endDate);
            } else if (isValidDateRange(startDate, endDate)) {
                updateDateRange(true, startDate, endDate);
            }
        },
        [startDate, endDate, updateDateRange]
    );

    // Handle date changes (only on blur)
    const handleStartDateBlur = useCallback(
        (newStartDate: string) => {
            if (useCustomDateRange && newStartDate && endDate && isValidDateRange(newStartDate, endDate)) {
                updateDateRange(true, newStartDate, endDate);
            }
        },
        [useCustomDateRange, endDate, updateDateRange]
    );

    const handleEndDateBlur = useCallback(
        (newEndDate: string) => {
            if (useCustomDateRange && startDate && newEndDate && isValidDateRange(startDate, newEndDate)) {
                updateDateRange(true, startDate, newEndDate);
            }
        },
        [useCustomDateRange, startDate, updateDateRange]
    );

    const handleAddFilter = useCallback(() => {
        if (!newFilterMetric) {
            onStatusChange('Filter metric is required', 'warning');
            return;
        }

        const filter: Filter = {
            id: generateId(),
            metric: newFilterMetric,
            minValue: newFilterMin ? parseFloat(newFilterMin) : undefined,
            maxValue: newFilterMax ? parseFloat(newFilterMax) : undefined
        };

        setFilters(prev => [...prev, filter]);
        setNewFilterMetric('');
        setNewFilterMin('');
        setNewFilterMax('');
        onStatusChange('Filter added successfully', 'success');
    }, [newFilterMetric, newFilterMin, newFilterMax, onStatusChange]);

    const handleRemoveFilter = useCallback((filterId: string) => {
        setFilters(prev => prev.filter(f => f.id !== filterId));
    }, []);

    const handleStartOptimisation = useCallback(() => {
        if (!config || !metric) {
            onStatusChange('Configuration and metric are required', 'warning');
            return;
        }

        if (useCustomDateRange && !isValidDateRange(startDate, endDate)) {
            onStatusChange('Invalid date range - please check start and end dates', 'error');
            return;
        }

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
    }, [
        config,
        metric,
        iterations,
        useCustomDateRange,
        startDate,
        endDate,
        minDelay,
        maxDelay,
        filters,
        onStartOptimisation,
        onStatusChange
    ]);

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
}
