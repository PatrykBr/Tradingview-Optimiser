import { useState, useCallback } from 'react';
import type { StatusType } from '../types';

/**
 * Custom hook for managing status messages
 * Provides a clean API for updating status with message and type
 */
export function useStatus(initialMessage = 'Ready', initialType: StatusType = 'info') {
    const [message, setMessage] = useState(initialMessage);
    const [type, setType] = useState<StatusType>(initialType);

    const updateStatus = useCallback((newMessage: string, newType: StatusType = 'info') => {
        setMessage(newMessage);
        setType(newType);
    }, []);

    const clearStatus = useCallback(() => {
        setMessage('Ready');
        setType('info');
    }, []);

    return {
        message,
        type,
        updateStatus,
        clearStatus
    };
}
