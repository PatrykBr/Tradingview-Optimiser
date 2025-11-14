import { Component, ReactNode } from 'react';
import { Card } from './ui';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error boundary component to catch and display React errors gracefully
 * Prevents the entire app from crashing when a component throws an error
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null
        };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {
            hasError: true,
            error
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('Error caught by boundary:', error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null
        });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className='flex min-h-screen items-center justify-center p-6'>
                    <Card title='⚠️ Something went wrong' className='max-w-lg'>
                        <div className='space-y-4'>
                            <p className='text-popup-text-secondary'>
                                An unexpected error occurred. This might be due to:
                            </p>
                            <ul className='text-popup-text-secondary list-inside list-disc space-y-1 text-sm'>
                                <li>Connection issues with TradingView</li>
                                <li>Invalid data in storage</li>
                                <li>Browser compatibility issues</li>
                            </ul>
                            {this.state.error && (
                                <details className='text-popup-text-secondary rounded border p-3 text-xs'>
                                    <summary className='cursor-pointer font-medium'>Error details</summary>
                                    <pre className='mt-2 overflow-auto'>{this.state.error.message}</pre>
                                </details>
                            )}
                            <button onClick={this.handleReset} className='btn btn-primary w-full'>
                                Try Again
                            </button>
                        </div>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
