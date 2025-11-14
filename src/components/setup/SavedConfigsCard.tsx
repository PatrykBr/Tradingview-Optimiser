import { memo, useMemo } from 'react';
import { Button, Select, Card } from '../ui';
import type { SavedOptimisationConfig } from '../../types';

interface SavedConfigsProps {
    savedConfigs: SavedOptimisationConfig[];
    selectedSavedConfig: string;
    onSelectedConfigChange: (configId: string) => void;
    onDeleteConfig: () => void;
}

export const SavedConfigsCard = memo(function SavedConfigsCard({
    savedConfigs,
    selectedSavedConfig,
    onSelectedConfigChange,
    onDeleteConfig
}: SavedConfigsProps) {
    const savedConfigOptions = useMemo(
        () =>
            savedConfigs.length > 0
                ? [
                      { value: '', label: 'Select a saved configuration...' },
                      ...savedConfigs.map(config => ({
                          value: config.id,
                          label: config.name
                      }))
                  ]
                : [{ value: '', label: 'No saved configurations for this strategy' }],
        [savedConfigs]
    );

    return (
        <Card title='Saved Configurations'>
            <div className='space-y-4'>
                <Select
                    options={savedConfigOptions}
                    value={selectedSavedConfig}
                    onChange={e => onSelectedConfigChange(e.target.value)}
                    disabled={savedConfigs.length === 0}
                />
                <Button variant='error' onClick={onDeleteConfig} disabled={!selectedSavedConfig} className='w-full'>
                    🗑️ Delete Configuration
                </Button>
            </div>
        </Card>
    );
});
