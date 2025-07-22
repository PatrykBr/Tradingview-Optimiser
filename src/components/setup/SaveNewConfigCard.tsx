import React from 'react';
import { Button, Input, Card } from '../ui';

interface SaveNewConfigProps {
    configName: string;
    configDescription: string;
    hasSelectedStrategy: boolean;
    onConfigNameChange: (name: string) => void;
    onConfigDescriptionChange: (description: string) => void;
    onSaveConfig: () => void;
}

export const SaveNewConfigCard: React.FC<SaveNewConfigProps> = ({
    configName,
    configDescription,
    hasSelectedStrategy,
    onConfigNameChange,
    onConfigDescriptionChange,
    onSaveConfig
}) => {
    return (
        <Card title='Save New Configuration'>
            <div className='space-y-4'>
                <Input
                    label='Configuration Name'
                    value={configName}
                    onChange={e => onConfigNameChange(e.target.value)}
                    placeholder='Enter configuration name...'
                />
                <Input
                    label='Description (optional)'
                    value={configDescription}
                    onChange={e => onConfigDescriptionChange(e.target.value)}
                    placeholder='Enter description...'
                />
                <Button variant='secondary' onClick={onSaveConfig} disabled={!configName || !hasSelectedStrategy}>
                    💾 Save as New Configuration
                </Button>
            </div>
        </Card>
    );
};
