import React from 'react';

interface CardProps {
    title?: string;
    children: React.ReactNode;
    className?: string;
}

export const Card: React.FC<CardProps> = ({ title, children, className = '' }) => {
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
};
