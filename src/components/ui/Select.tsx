import { memo } from 'react';
import type { SelectHTMLAttributes } from 'react';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    options: SelectOption[];
    label?: string;
}

export const Select = memo(function Select({ options, label, className = '', ...props }: SelectProps) {
    return (
        <div className='space-y-1'>
            {label && (
                <label className='block text-sm font-medium' style={{ color: 'var(--color-popup-text)' }}>
                    {label}
                </label>
            )}
            <select className={`select ${className}`} {...props}>
                {options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
});
