import React from 'react';
import { Input, Card } from '../ui';

interface DateRangeProps {
    useCustomDateRange: boolean;
    startDate: string;
    endDate: string;
    onToggleCustomRange: (enabled: boolean) => void;
    onStartDateChange: (date: string) => void;
    onEndDateChange: (date: string) => void;
}

export const DateRangeCard: React.FC<DateRangeProps> = ({
    useCustomDateRange,
    startDate,
    endDate,
    onToggleCustomRange,
    onStartDateChange,
    onEndDateChange
}) => {
    return (
        <Card title='Date Range Settings'>
            <div className='space-y-4'>
                <label className='flex items-center gap-3'>
                    <input
                        type='checkbox'
                        checked={useCustomDateRange}
                        onChange={e => onToggleCustomRange(e.target.checked)}
                        className='border-popup-border rounded'
                    />
                    <span className='font-medium'>Use Custom Date Range</span>
                </label>

                {useCustomDateRange && (
                    <div className='grid grid-cols-2 gap-4'>
                        <Input
                            label='Start Date'
                            type='date'
                            value={startDate}
                            onChange={e => onStartDateChange(e.target.value)}
                        />
                        <Input
                            label='End Date'
                            type='date'
                            value={endDate}
                            onChange={e => onEndDateChange(e.target.value)}
                        />
                    </div>
                )}
            </div>
        </Card>
    );
};
