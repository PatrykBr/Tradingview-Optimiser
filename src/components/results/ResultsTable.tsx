import React from 'react';
import type { OptimisationResult } from '../../types';

interface ResultsTableProps {
    results: OptimisationResult[];
    bestResult: OptimisationResult | null;
    sortBy: string;
    sortDirection: 'asc' | 'desc';
    onSort: (column: string) => void;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({ results, bestResult, sortBy, sortDirection, onSort }) => {
    const formatValue = (value: number): string => {
        if (Math.abs(value) < 1000) {
            return value.toFixed(2);
        }
        return value.toLocaleString();
    };

    const getSortIcon = (column: string): string => {
        if (sortBy !== column) return '↕️';
        return sortDirection === 'asc' ? '⬆️' : '⬇️';
    };

    if (results.length === 0) {
        return (
            <div className='text-popup-text-secondary py-8 text-center'>
                <p>No optimisation results yet</p>
                <p className='mt-2 text-sm'>Configure your strategy and start optimisation to see results here.</p>
            </div>
        );
    }

    return (
        <div className='overflow-x-auto'>
            <table className='w-full border-collapse'>
                <thead>
                    <tr className='border-popup-border border-b'>
                        <th
                            className='hover:bg-popup-card cursor-pointer p-2 text-left'
                            onClick={() => onSort('iteration')}
                        >
                            Iteration {getSortIcon('iteration')}
                        </th>
                        {bestResult &&
                            Object.keys(bestResult.parameters).map(param => (
                                <th
                                    key={param}
                                    className='hover:bg-popup-card cursor-pointer p-2 text-left'
                                    onClick={() => onSort(param)}
                                >
                                    {param} {getSortIcon(param)}
                                </th>
                            ))}
                        {bestResult &&
                            Object.keys(bestResult.metrics).map(metric => (
                                <th
                                    key={metric}
                                    className='hover:bg-popup-card cursor-pointer p-2 text-left'
                                    onClick={() => onSort(metric)}
                                >
                                    {metric} {getSortIcon(metric)}
                                </th>
                            ))}
                        <th className='p-2 text-left'>Time</th>
                    </tr>
                </thead>
                <tbody>
                    {results.map(result => (
                        <tr
                            key={result.id}
                            className={`border-popup-border hover:bg-popup-card border-b ${
                                result.id === bestResult?.id ? 'bg-popup-success bg-opacity-20' : ''
                            }`}
                        >
                            <td className='p-2 font-mono'>{result.iteration}</td>
                            {Object.values(result.parameters).map((value, paramIndex) => (
                                <td key={paramIndex} className='p-2 font-mono'>
                                    {formatValue(value)}
                                </td>
                            ))}
                            {Object.values(result.metrics).map((value, metricIndex) => (
                                <td key={metricIndex} className='p-2 font-mono'>
                                    {formatValue(value)}
                                </td>
                            ))}
                            <td className='text-popup-text-secondary p-2 text-xs'>
                                {new Date(result.timestamp).toLocaleTimeString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
