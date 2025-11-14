import { Card } from '../ui';
import type { OptimisationConfig } from '../../types';

interface CurrentConfigProps {
    config: OptimisationConfig;
}

export function CurrentConfigCard({ config }: CurrentConfigProps) {
    return (
        <Card title='Current Configuration'>
            <div className='space-y-2'>
                <p>
                    <strong>Strategy:</strong> {config.strategyName}
                </p>
                <p>
                    <strong>Parameters to optimise:</strong> {config.parameters.length}
                </p>
                <div className='space-y-1'>
                    {config.parameters.map((param, index) => (
                        <div key={index} className='text-popup-text-secondary text-sm'>
                            • {param.label} ({param.minValue} - {param.maxValue})
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}
