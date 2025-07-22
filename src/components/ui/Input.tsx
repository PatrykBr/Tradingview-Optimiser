import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
    return (
        <div className='space-y-1'>
            {label && (
                <label className='block text-sm font-medium' style={{ color: 'var(--color-popup-text)' }}>
                    {label}
                </label>
            )}
            <input className={`input ${error ? 'border-red-500' : ''} ${className}`} {...props} />
            {error && (
                <p className='text-sm' style={{ color: 'var(--color-popup-error)' }}>
                    {error}
                </p>
            )}
        </div>
    );
};
