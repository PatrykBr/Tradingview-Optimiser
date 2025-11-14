import { Card } from '../ui';
import type { OptimisationResult } from '../../types';

interface BestResultProps {
    bestResult: OptimisationResult;
}

export function BestResultCard({ bestResult }: BestResultProps) {
    const formatValue = (value: number): string => {
        if (Math.abs(value) < 1000) {
            return value.toFixed(2);
        }
        return value.toLocaleString();
    };

    return (
        <Card title='Best Result'>
            <div className='space-y-4'>
                <div className='grid grid-cols-2 gap-4'>
                    <div>
                        <h4 className='mb-2 font-medium'>Parameters:</h4>
                        <div className='space-y-1'>
                            {Object.entries(bestResult.parameters).map(([key, value]) => (
                                <div key={key} className='flex justify-between text-sm'>
                                    <span>{key}:</span>
                                    <span className='font-mono'>{formatValue(value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h4 className='mb-2 font-medium'>Metrics:</h4>
                        <div className='space-y-1'>
                            {Object.entries(bestResult.metrics).map(([key, value]) => (
                                <div key={key} className='flex justify-between text-sm'>
                                    <span>{key}:</span>
                                    <span className='font-mono'>{formatValue(value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className='text-popup-text-secondary text-xs'>
                    Iteration: {bestResult.iteration} | {new Date(bestResult.timestamp).toLocaleString()}
                </div>
            </div>
        </Card>
    );
}
