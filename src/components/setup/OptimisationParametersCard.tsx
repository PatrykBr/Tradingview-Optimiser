import { Input, Card } from '../ui';
import type { OptimisationParameter, ParameterValue } from '../../types';

interface OptimisationParametersProps {
    parameters: OptimisationParameter[];
    onParameterChange: (index: number, field: keyof OptimisationParameter, value: ParameterValue) => void;
}

export function OptimisationParametersCard({ parameters, onParameterChange }: OptimisationParametersProps) {
    return (
        <Card title='Optimisation Parameters'>
            <p className='text-popup-text-secondary mb-4'>
                Select which parameters to optimise and set their value ranges:
            </p>
            <div className='space-y-2'>
                {parameters.map((param, index) => (
                    <div
                        key={param.label}
                        className={`border-popup-border rounded-lg border ${param.enabled ? 'p-4' : 'p-2'}`}
                    >
                        <div className={`flex items-center justify-between ${param.enabled ? 'mb-3' : ''}`}>
                            <label className='flex items-center gap-2'>
                                <input
                                    type='checkbox'
                                    checked={param.enabled}
                                    onChange={e => onParameterChange(index, 'enabled', e.target.checked)}
                                    className='border-popup-border rounded'
                                />
                                <span className='font-medium'>{param.label}</span>
                                <span className='text-popup-text-secondary text-sm'>
                                    (current: {param.currentValue})
                                </span>
                            </label>
                        </div>

                        {param.enabled && (
                            <div className='grid grid-cols-2 gap-3'>
                                <Input
                                    label='Min Value'
                                    type='number'
                                    value={param.minValue}
                                    onChange={e => onParameterChange(index, 'minValue', parseFloat(e.target.value))}
                                />
                                <Input
                                    label='Max Value'
                                    type='number'
                                    value={param.maxValue}
                                    onChange={e => onParameterChange(index, 'maxValue', parseFloat(e.target.value))}
                                />
                            </div>
                        )}

                        {param.tooltip && <p className='text-popup-text-secondary mt-2 text-sm'>{param.tooltip}</p>}
                    </div>
                ))}
            </div>
        </Card>
    );
}
