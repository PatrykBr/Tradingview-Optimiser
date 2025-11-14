interface StatusProps {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
}

const STATUS_STYLES = {
    success: {
        backgroundColor: 'var(--color-popup-success)',
        borderColor: 'var(--color-popup-success)',
        color: 'white',
        opacity: 0.9
    },
    warning: {
        backgroundColor: 'var(--color-popup-warning)',
        borderColor: 'var(--color-popup-warning)',
        color: 'white',
        opacity: 0.9
    },
    error: {
        backgroundColor: 'var(--color-popup-error)',
        borderColor: 'var(--color-popup-error)',
        color: 'white',
        opacity: 0.9
    },
    info: {
        backgroundColor: 'var(--color-popup-accent)',
        borderColor: 'var(--color-popup-accent)',
        color: 'white',
        opacity: 0.9
    }
} as const;

export function Status({ message, type = 'info' }: StatusProps) {
    return (
        <div className='rounded-lg border p-3 text-sm font-medium' style={STATUS_STYLES[type]}>
            {message}
        </div>
    );
}
