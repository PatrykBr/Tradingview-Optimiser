import { memo } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
}

export const Input = memo(function Input({ label, className = '', ...props }: InputProps) {
    return (
        <div className='space-y-1'>
            {label && (
                <label className='block text-sm font-medium' style={{ color: 'var(--color-popup-text)' }}>
                    {label}
                </label>
            )}
            <input className={`input ${className}`} {...props} />
        </div>
    );
});
