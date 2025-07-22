import React from 'react';
import { Input, Card } from '../ui';

interface AntiDetectionProps {
    minDelay: number;
    maxDelay: number;
    onMinDelayChange: (delay: number) => void;
    onMaxDelayChange: (delay: number) => void;
}

export const AntiDetectionCard: React.FC<AntiDetectionProps> = ({
    minDelay,
    maxDelay,
    onMinDelayChange,
    onMaxDelayChange
}) => {
    return (
        <Card title='Anti-Detection Delays'>
            <div className='grid grid-cols-2 gap-4'>
                <Input
                    label='Min Delay (ms)'
                    type='number'
                    min={0}
                    value={minDelay}
                    onChange={e => onMinDelayChange(parseInt(e.target.value) || 100)}
                    placeholder='e.g., 100'
                />
                <Input
                    label='Max Delay (ms)'
                    type='number'
                    min={0}
                    value={maxDelay}
                    onChange={e => onMaxDelayChange(parseInt(e.target.value) || 500)}
                    placeholder='e.g., 500'
                />
            </div>
        </Card>
    );
};
