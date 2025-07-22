import React from 'react';
import { Button, Select, Card } from '../ui';
import type { SavedOptimisationConfig } from '../../types';

interface SavedConfigsProps {
    savedConfigs: SavedOptimisationConfig[];
    selectedSavedConfig: string;
    onSelectedConfigChange: (configId: string) => void;
    onLoadConfig: () => void;
    onDeleteConfig: () => void;
}

export const SavedConfigsCard: React.FC<SavedConfigsProps> = ({
    savedConfigs,
    selectedSavedConfig,
    onSelectedConfigChange,
    onLoadConfig,
    onDeleteConfig
}) => {
    const savedConfigOptions = [
        { value: '', label: 'Select a saved configuration...' },
        ...savedConfigs.map(config => ({
            value: config.id,
            label: config.name
        }))
    ];

    return (
        <Card title='Saved Configurations'>
            <div className='space-y-4'>
                <Select
                    options={savedConfigOptions}
                    value={selectedSavedConfig}
                    onChange={e => onSelectedConfigChange(e.target.value)}
                />
                <div className='flex gap-2'>
                    <Button variant='error' onClick={onDeleteConfig} disabled={!selectedSavedConfig}>
                        🗑️ Delete
                    </Button>
                    <Button variant='secondary' onClick={onLoadConfig} disabled={!selectedSavedConfig}>
                        📂 Load
                    </Button>
                </div>
            </div>
        </Card>
    );
};
