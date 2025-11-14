import { memo } from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    message?: string;
}

/**
 * Loading spinner component with optional message
 * Provides visual feedback during async operations
 */
export const LoadingSpinner = memo(function LoadingSpinner({ size = 'md', message }: LoadingSpinnerProps) {
    const sizeClasses = {
        sm: 'h-4 w-4',
        md: 'h-8 w-8',
        lg: 'h-12 w-12'
    };

    return (
        <div className='flex flex-col items-center justify-center gap-3'>
            <div className={`${sizeClasses[size]} animate-spin`}>
                <svg className='h-full w-full' xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24'>
                    <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
                    <path
                        className='opacity-75'
                        fill='currentColor'
                        d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                    />
                </svg>
            </div>
            {message && <p className='text-popup-text-secondary text-sm'>{message}</p>}
        </div>
    );
});
