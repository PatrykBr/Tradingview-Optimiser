import { SELECTORS, TIMING, UI_TEXT } from '../config';

/**
 * Handles date range changes in TradingView's backtesting interface
 * Interacts with TradingView's date range picker to set custom or chart-based ranges
 */
export class DateRangeHandler {
    /**
     * Change the backtest date range
     * @param enabled Whether to use custom date range or "Range from chart"
     * @param startDate Start date in YYYY-MM-DD format (required when enabled=true)
     * @param endDate End date in YYYY-MM-DD format (required when enabled=true)
     * @returns Object with success status and additional info
     */
    async changeDateRange(
        enabled: boolean,
        startDate: string,
        endDate: string
    ): Promise<{ success: boolean; alreadySet?: boolean }> {
        const mainButton = (await this.waitForElement(SELECTORS.dateRange.mainButton)) as HTMLButtonElement;
        if (!mainButton) throw new Error(UI_TEXT.errors.dateRangeButtonNotFound);

        mainButton.click();
        await this.sleep(TIMING.MENU_OPEN_DELAY);

        const result = enabled
            ? await this.selectCustomDateRange(startDate, endDate)
            : await this.selectRangeFromChart();

        return result;
    }

    private async selectRangeFromChart(): Promise<{ success: boolean }> {
        const rangeFromChart = (await this.waitForElement(SELECTORS.dateRange.rangeFromChart)) as HTMLElement;
        if (!rangeFromChart) throw new Error(UI_TEXT.errors.rangeFromChartNotFound);

        rangeFromChart.click();
        return { success: true };
    }

    private async selectCustomDateRange(
        startDate: string,
        endDate: string
    ): Promise<{ success: boolean; alreadySet?: boolean }> {
        const customDateRange = (await this.waitForElement(SELECTORS.dateRange.customDateRange)) as HTMLElement;
        if (!customDateRange) {
            throw new Error(UI_TEXT.errors.customDateRangeNotFound);
        }

        customDateRange.click();
        await this.sleep(TIMING.MENU_OPEN_DELAY);

        const dialog = await this.waitForElement(SELECTORS.dateRange.dialog);
        if (!dialog) {
            throw new Error(UI_TEXT.errors.dateRangeDialogNotFound);
        }

        await this.setDateInputs(startDate, endDate);

        return this.submitDateRange();
    }

    private async setDateInputs(startDate: string, endDate: string): Promise<void> {
        const startDateInput = (await this.waitForElement(SELECTORS.dateRange.startDateInput)) as HTMLInputElement;
        if (!startDateInput) {
            throw new Error(UI_TEXT.errors.startDateInputNotFound);
        }

        const endDateInput = (await this.waitForElement(SELECTORS.dateRange.endDateInput)) as HTMLInputElement;
        if (!endDateInput) {
            throw new Error(UI_TEXT.errors.endDateInputNotFound);
        }

        await this.setInputValue(startDateInput, startDate);
        await this.setInputValue(endDateInput, endDate);
    }

    private async submitDateRange(): Promise<{ success: boolean; alreadySet?: boolean }> {
        const selectButton = (await this.waitForElement(SELECTORS.dateRange.selectButton)) as HTMLButtonElement;
        if (!selectButton) {
            throw new Error(UI_TEXT.errors.selectButtonNotFound);
        }

        const isDisabled =
            selectButton.hasAttribute('aria-disabled') && selectButton.getAttribute('aria-disabled') === 'true';

        if (isDisabled) {
            return this.handleDisabledSelectButton();
        }

        await this.sleep(TIMING.MENU_OPEN_DELAY);
        selectButton.click();
        return { success: true };
    }

    private async handleDisabledSelectButton(): Promise<{ success: boolean; alreadySet: boolean }> {
        const cancelButton = (await this.waitForElement(SELECTORS.dateRange.cancelButton)) as HTMLButtonElement;
        if (!cancelButton) {
            throw new Error('Select button is disabled and Cancel button not found');
        }

        cancelButton.click();
        return { success: true, alreadySet: true };
    }

    /**
     * Set the value of an input element
     */
    private async setInputValue(input: HTMLInputElement, value: string): Promise<void> {
        // Clear the current value
        input.focus();
        input.select();

        // Set the new value
        input.value = value;

        // Trigger input events to notify the application
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });

        input.dispatchEvent(inputEvent);
        input.dispatchEvent(changeEvent);

        // Add a small delay to ensure the UI processes the change
        await this.sleep(TIMING.INPUT_CHANGE_DELAY);
    }

    /**
     * Wait for an element to appear in the DOM
     */
    private async waitForElement(selector: string): Promise<Element | null> {
        const startTime = Date.now();

        while (Date.now() - startTime < TIMING.ELEMENT_WAIT_TIMEOUT) {
            const element = document.querySelector(selector);
            if (element) {
                return element;
            }
            await this.sleep(TIMING.ELEMENT_RETRY_INTERVAL);
        }

        return null;
    }

    /**
     * Sleep for the specified number of milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
