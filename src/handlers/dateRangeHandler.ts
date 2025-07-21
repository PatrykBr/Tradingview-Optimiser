import { SELECTORS } from '../config';

export class DateRangeHandler {
  private static readonly WAIT_TIMEOUT = 5000;
  private static readonly RETRY_INTERVAL = 100;

  /**
   * Change the backtest date range
   * @param enabled Whether to use custom date range or "Range from chart"
   * @param startDate Start date in YYYY-MM-DD format (optional, defaults to 1 year ago)
   * @param endDate End date in YYYY-MM-DD format (optional, defaults to today)
   * @returns Object with success status and additional info
   */
  async changeDateRange(enabled: boolean, startDate?: string, endDate?: string): Promise<{ success: boolean, alreadySet?: boolean }> {
    try {
      const mainButton = await this.waitForElement(SELECTORS.dateRange.mainButton) as HTMLButtonElement;
      if (!mainButton) throw new Error('Could not find date range button');

      mainButton.click();
      await this.sleep(500);

      return enabled ? this.selectCustomDateRange(startDate, endDate) : this.selectRangeFromChart();
    } catch (error) {
      console.error('Error changing date range:', error);
      return { success: false };
    }
  }

  private async selectRangeFromChart(): Promise<{ success: boolean }> {
    const rangeFromChart = await this.waitForElement(SELECTORS.dateRange.rangeFromChart) as HTMLElement;
    if (!rangeFromChart) throw new Error('Could not find "Range from chart" option');
    
    rangeFromChart.click();
    return { success: true };
  }

  private async selectCustomDateRange(startDate?: string, endDate?: string): Promise<{ success: boolean, alreadySet?: boolean }> {
    const customDateRange = await this.waitForElement(SELECTORS.dateRange.customDateRange) as HTMLElement;
    if (!customDateRange) {
      throw new Error('Could not find "Custom date range" option');
    }

    customDateRange.click();
    await this.sleep(500);

    const dialog = await this.waitForElement(SELECTORS.dateRange.dialog);
    if (!dialog) {
      throw new Error('Could not find date range dialog');
    }

    const { finalStartDate, finalEndDate } = this.getDateRange(startDate, endDate);
    
    await this.setDateInputs(finalStartDate, finalEndDate);
    
    return this.submitDateRange();
  }

  private getDateRange(startDate?: string, endDate?: string): { finalStartDate: string, finalEndDate: string } {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    return {
      finalStartDate: startDate || this.formatDate(oneYearAgo),
      finalEndDate: endDate || this.formatDate(today)
    };
  }

  private async setDateInputs(startDate: string, endDate: string): Promise<void> {
    const startDateInput = await this.waitForElement(SELECTORS.dateRange.startDateInput) as HTMLInputElement;
    if (!startDateInput) {
      throw new Error('Could not find start date input');
    }

    const endDateInput = await this.waitForElement(SELECTORS.dateRange.endDateInput) as HTMLInputElement;
    if (!endDateInput) {
      throw new Error('Could not find end date input');
    }

    await this.setInputValue(startDateInput, startDate);
    await this.setInputValue(endDateInput, endDate);
  }

  private async submitDateRange(): Promise<{ success: boolean, alreadySet?: boolean }> {
    const selectButton = await this.waitForElement(SELECTORS.dateRange.selectButton) as HTMLButtonElement;
    if (!selectButton) {
      throw new Error('Could not find Select button');
    }

    const isDisabled = selectButton.hasAttribute('aria-disabled') && selectButton.getAttribute('aria-disabled') === 'true';
    
    if (isDisabled) {
      return this.handleDisabledSelectButton();
    }

    await this.sleep(500);
    selectButton.click();
    return { success: true };
  }

  private async handleDisabledSelectButton(): Promise<{ success: boolean, alreadySet: boolean }> {
    const cancelButton = await this.waitForElement(SELECTORS.dateRange.cancelButton) as HTMLButtonElement;
    if (cancelButton) {
      cancelButton.click();
      return { success: true, alreadySet: true };
    }

    const closeButton = await this.waitForElement(SELECTORS.dateRange.closeButton) as HTMLButtonElement;
    if (closeButton) {
      closeButton.click();
      return { success: true, alreadySet: true };
    }

    throw new Error('Select button is disabled and could not find Cancel/Close button');
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
    await this.sleep(100);
  }

  /**
   * Format a date to YYYY-MM-DD format
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Wait for an element to appear in the DOM
   */
  private async waitForElement(selector: string): Promise<Element | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < DateRangeHandler.WAIT_TIMEOUT) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await this.sleep(DateRangeHandler.RETRY_INTERVAL);
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
