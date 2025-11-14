/**
 * Validation utilities for user inputs
 */

/**
 * Validates a date string in YYYY-MM-DD format
 */
export const isValidDate = (dateString: string): boolean => {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
};

/**
 * Validates that start date is before or equal to end date
 */
export const isValidDateRange = (startDate: string, endDate: string): boolean => {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return false;
    return new Date(startDate) <= new Date(endDate);
};
