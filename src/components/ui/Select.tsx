import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select: React.FC<SelectProps> = ({ label, error, options, className = '', ...props }) => {
    return (
        <div className='space-y-1'>
            {label && (
                <label className='block text-sm font-medium' style={{ color: 'var(--color-popup-text)' }}>
                    {label}
                </label>
            )}
            <select className={`select ${error ? 'border-red-500' : ''} ${className}`} {...props}>
                {options.map(option => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
            {error && (
                <p className='text-sm' style={{ color: 'var(--color-popup-error)' }}>
                    {error}
                </p>
            )}
        </div>
    );
};
