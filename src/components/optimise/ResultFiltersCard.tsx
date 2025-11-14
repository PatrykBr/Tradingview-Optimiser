import { Button, Input, Select, Card } from '../ui';
import { AVAILABLE_METRICS } from '../../config';
import type { Filter } from '../../types';

interface ResultFiltersProps {
    filters: Filter[];
    newFilterMetric: string;
    newFilterMin: string;
    newFilterMax: string;
    selectedMetric: string;
    onNewFilterMetricChange: (metric: string) => void;
    onNewFilterMinChange: (min: string) => void;
    onNewFilterMaxChange: (max: string) => void;
    onAddFilter: () => void;
    onRemoveFilter: (filterId: string) => void;
}

export function ResultFiltersCard({
    filters,
    newFilterMetric,
    newFilterMin,
    newFilterMax,
    selectedMetric,
    onNewFilterMetricChange,
    onNewFilterMinChange,
    onNewFilterMaxChange,
    onAddFilter,
    onRemoveFilter
}: ResultFiltersProps) {
    const filterMetricOptions = [
        { value: '', label: 'Select metric to filter...' },
        ...AVAILABLE_METRICS.filter(m => m.value !== selectedMetric)
    ];

    return (
        <Card title='Result Filters'>
            <div className='space-y-4'>
                <div className='grid grid-cols-3 gap-3'>
                    <Select
                        options={filterMetricOptions}
                        value={newFilterMetric}
                        onChange={e => onNewFilterMetricChange(e.target.value)}
                    />
                    <Input
                        type='number'
                        value={newFilterMin}
                        onChange={e => onNewFilterMinChange(e.target.value)}
                        placeholder='Min value (optional)'
                    />
                    <Input
                        type='number'
                        value={newFilterMax}
                        onChange={e => onNewFilterMaxChange(e.target.value)}
                        placeholder='Max value (optional)'
                    />
                </div>
                <Button variant='secondary' onClick={onAddFilter} disabled={!newFilterMetric}>
                    ➕ Add Filter
                </Button>
            </div>

            {filters.length > 0 && (
                <div className='space-y-2'>
                    <h4 className='font-medium'>Active Filters:</h4>
                    {filters.map(filter => (
                        <div
                            key={filter.id}
                            className='bg-popup-card border-popup-border flex items-center justify-between rounded-lg border p-3'
                        >
                            <span>
                                {AVAILABLE_METRICS.find(m => m.value === filter.metric)?.label}
                                {filter.minValue !== undefined && ` ≥ ${filter.minValue}`}
                                {filter.maxValue !== undefined && ` ≤ ${filter.maxValue}`}
                            </span>
                            <Button variant='error' size='sm' onClick={() => onRemoveFilter(filter.id)}>
                                ✕
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {filters.length === 0 && <div className='text-popup-text-secondary italic'>No filters applied</div>}
        </Card>
    );
}
