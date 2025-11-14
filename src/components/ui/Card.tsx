import { memo } from 'react';
import type { ReactNode } from 'react';

interface CardProps {
    title?: string;
    children: ReactNode;
    className?: string;
}

export const Card = memo(function Card({ title, children, className = '' }: CardProps) {
    return (
        <div className={`card ${className}`}>
            {title && (
                <h3 className='mb-4 text-lg font-semibold' style={{ color: 'var(--color-popup-text)' }}>
                    {title}
                </h3>
            )}
            {children}
        </div>
    );
});
