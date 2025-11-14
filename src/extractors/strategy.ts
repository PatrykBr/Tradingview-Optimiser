import { SELECTORS, UI_TEXT } from '../config';
import type { StrategySettings } from '../types';

/**
 * Extracts strategy information from TradingView's DOM
 * Handles both strategy list extraction and settings dialog interactions
 */
export class StrategyExtractor {
    /**
     * Extract all visible strategies from the TradingView page
     * @returns Array of strategy settings with names and timestamps
     */
    extract(): StrategySettings[] {
        const strategyContainer = document.querySelector(SELECTORS.strategies.container);
        if (!strategyContainer) {
            throw new Error(UI_TEXT.errors.strategyContainerNotFound);
        }

        const strategyItems = strategyContainer.querySelectorAll(SELECTORS.strategies.items);
        if (strategyItems.length === 0) {
            throw new Error('No strategy items found - ensure strategies are loaded on the chart');
        }

        return Array.from(strategyItems).map((item, index) => {
            const titleElement = item.querySelector(SELECTORS.strategies.title);
            const titleText = titleElement?.textContent?.trim();

            if (!titleText) {
                throw new Error(`Strategy ${index + 1} has no title element - DOM structure may have changed`);
            }

            return {
                name: titleText,
                settings: [],
                timestamp: new Date().toISOString()
            };
        });
    }

    /**
     * Open strategy settings dialog and extract all parameter values
     * @param strategyIndex - Zero-based index of the strategy to open
     * @returns Strategy settings with all parameters
     * @throws Error if strategy not found or dialog fails to open
     */
    async openSettings(strategyIndex: number): Promise<StrategySettings> {
        const strategyContainer = document.querySelector(SELECTORS.strategies.container);
        if (!strategyContainer) {
            throw new Error(UI_TEXT.errors.strategyContainerNotFound);
        }

        const strategyItems = strategyContainer.querySelectorAll(SELECTORS.strategies.items);
        if (strategyIndex < 0 || strategyIndex >= strategyItems.length) {
            throw new Error(UI_TEXT.errors.invalidStrategyIndex(strategyIndex, strategyItems.length));
        }

        const strategyItem = strategyItems[strategyIndex];
        const settingsButton = strategyItem.querySelector(SELECTORS.strategies.settingsButton) as HTMLButtonElement;

        if (!settingsButton) {
            throw new Error(UI_TEXT.errors.settingsButtonNotFound(strategyIndex));
        }

        // TradingView requires multiple event types to properly trigger the dialog
        settingsButton.focus();
        settingsButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        settingsButton.click();
        settingsButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

        const dialog = await this.waitForDialog();
        return this.extractDialogSettings(dialog);
    }

    private async waitForDialog(): Promise<Element> {
        const maxAttempts = 20;
        const delayMs = 300;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            const dialog = document.querySelector(SELECTORS.settingsDialog.container);
            if (dialog) {
                return dialog;
            }
        }

        throw new Error(UI_TEXT.errors.dialogNotAppear);
    }

    private async extractDialogSettings(dialog: Element): Promise<StrategySettings> {
        const titleElement = dialog.querySelector(SELECTORS.settingsDialog.title);
        const dialogTitle = titleElement?.textContent?.trim();

        if (!dialogTitle) {
            throw new Error(UI_TEXT.errors.dialogNoTitle);
        }

        const labels = dialog.querySelectorAll(SELECTORS.settingsDialog.inputLabels);
        const values = dialog.querySelectorAll(SELECTORS.settingsDialog.inputValues);

        const settings: Array<{ label: string; value: string; tooltip?: string }> = [];

        labels.forEach((label: Element, index: number) => {
            const labelText = label.textContent?.trim();
            const valueElement = values[index];

            if (!labelText || !valueElement) return;

            const value = this.extractInputValue(valueElement, labelText);
            if (value) {
                settings.push({ label: labelText, value });
            }
        });

        // Close dialog with multiple fallback methods
        await this.closeDialog(dialog);

        return { name: dialogTitle, settings, timestamp: new Date().toISOString() };
    }

    private extractInputValue(valueElement: Element, labelText: string): string {
        if (valueElement instanceof HTMLInputElement) {
            if (valueElement.type === 'checkbox') {
                return valueElement.checked ? 'true' : 'false';
            }
            const inputValue = valueElement.value?.trim();
            if (!inputValue) {
                throw new Error(`Input element for "${labelText}" has no value`);
            }
            return inputValue;
        }

        if (valueElement instanceof HTMLSelectElement) {
            const selectValue = valueElement.value?.trim();
            if (!selectValue) {
                throw new Error(`Select element for "${labelText}" has no value`);
            }
            return selectValue;
        }

        const textValue = valueElement.textContent?.trim();
        if (!textValue) {
            throw new Error(`Element for "${labelText}" has no text content`);
        }
        return textValue;
    }

    private async closeDialog(dialog: Element): Promise<void> {
        const okButton = dialog.querySelector(SELECTORS.settingsDialog.okButton) as HTMLButtonElement;

        if (!okButton) {
            throw new Error('OK button not found in settings dialog');
        }

        okButton.focus();
        okButton.click();
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}
