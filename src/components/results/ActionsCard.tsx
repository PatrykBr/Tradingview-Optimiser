import React from 'react';
import { Button, Card } from '../ui';

interface ActionsCardProps {
    hasResults: boolean;
    hasBestResult: boolean;
    isOptimising: boolean;
    onApplyBest: () => void;
    onExportCSV: () => void;
    onExportJSON: () => void;
}

export const ActionsCard: React.FC<ActionsCardProps> = ({
    hasResults,
    hasBestResult,
    isOptimising,
    onApplyBest,
    onExportCSV,
    onExportJSON
}) => {
    if (!hasResults) return null;

    return (
        <Card title='Actions'>
            <div className='flex flex-wrap gap-3'>
                <Button variant='primary' onClick={onApplyBest} disabled={!hasBestResult || isOptimising}>
                    ✅ Apply Best
                </Button>
                <Button variant='secondary' onClick={onExportCSV} disabled={!hasResults}>
                    📄 Export CSV
                </Button>
                <Button variant='secondary' onClick={onExportJSON} disabled={!hasResults}>
                    📋 Export JSON
                </Button>
            </div>
        </Card>
    );
};
