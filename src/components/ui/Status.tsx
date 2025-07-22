import React from 'react';

interface StatusProps {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
}

export const Status: React.FC<StatusProps> = ({ message, type = 'info' }) => {
    const getStatusStyles = () => {
        switch (type) {
            case 'success':
                return {
                    backgroundColor: 'var(--color-popup-success)',
                    borderColor: 'var(--color-popup-success)',
                    color: 'white',
                    opacity: 0.9
                };
            case 'warning':
                return {
                    backgroundColor: 'var(--color-popup-warning)',
                    borderColor: 'var(--color-popup-warning)',
                    color: 'white',
                    opacity: 0.9
                };
            case 'error':
                return {
                    backgroundColor: 'var(--color-popup-error)',
                    borderColor: 'var(--color-popup-error)',
                    color: 'white',
                    opacity: 0.9
                };
            default:
                return {
                    backgroundColor: 'var(--color-popup-accent)',
                    borderColor: 'var(--color-popup-accent)',
                    color: 'white',
                    opacity: 0.9
                };
        }
    };

    return (
        <div className='rounded-lg border p-3 text-sm font-medium' style={getStatusStyles()}>
            {message}
        </div>
    );
};
