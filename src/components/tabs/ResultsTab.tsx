import { useState } from 'react';
import { Card } from '../ui';
import { BestResultCard, ActionsCard, ResultsTable } from '../results';
import type { OptimisationResult } from '../../types';

interface ResultsTabProps {
    results: OptimisationResult[];
    bestResult: OptimisationResult | null;
    isOptimising: boolean;
    onApplyBest: () => void;
    onExportCSV: () => void;
    onExportJSON: () => void;
}

export function ResultsTab({
    results,
    bestResult,
    isOptimising,
    onApplyBest,
    onExportCSV,
    onExportJSON
}: ResultsTabProps) {
    const [sortBy, setSortBy] = useState<string>('iteration');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    const sortedResults = [...results].sort((a, b) => {
        let aValue: string | number, bValue: string | number;

        if (sortBy === 'iteration') {
            aValue = a.iteration;
            bValue = b.iteration;
        } else if (sortBy in a.metrics) {
            aValue = a.metrics[sortBy];
            bValue = b.metrics[sortBy];
        } else if (sortBy in a.parameters) {
            aValue = a.parameters[sortBy];
            bValue = b.parameters[sortBy];
        } else {
            return 0;
        }

        if (sortDirection === 'asc') {
            return aValue > bValue ? 1 : -1;
        } else {
            return aValue < bValue ? 1 : -1;
        }
    });

    const handleSort = (column: string) => {
        if (sortBy === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortDirection('desc');
        }
    };

    const hasResults = results.length > 0;

    return (
        <div className='space-y-6'>
            {bestResult && <BestResultCard bestResult={bestResult} />}

            <ActionsCard
                hasResults={hasResults}
                hasBestResult={!!bestResult}
                isOptimising={isOptimising}
                onApplyBest={onApplyBest}
                onExportCSV={onExportCSV}
                onExportJSON={onExportJSON}
            />

            <Card title={`All Results (${results.length})`}>
                {isOptimising && (
                    <div className='bg-popup-accent bg-opacity-20 border-popup-accent mb-4 rounded-lg border p-3'>
                        <p className='text-popup-accent font-medium'>
                            🔄 Optimisation in progress... Results will appear below as they come in.
                        </p>
                    </div>
                )}

                <ResultsTable
                    results={sortedResults}
                    bestResult={bestResult}
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                />
            </Card>
        </div>
    );
}
