import { SELECTORS } from '../config';
import type { StrategySettings } from '../types';

export class StrategyExtractor {
    extract(): StrategySettings[] {
        const strategyContainer = document.querySelector(SELECTORS.strategies.container);
        if (!strategyContainer) return [];

        const strategyItems = strategyContainer.querySelectorAll(SELECTORS.strategies.items);

        return Array.from(strategyItems).map((item, index) => {
            const titleElement = item.querySelector(SELECTORS.strategies.title);
            const titleText = titleElement?.textContent?.trim();

            if (!titleText) {
                throw new Error(`Strategy ${index + 1} has no title element - DOM structure may have changed`);
            }

            const strategyName = titleText;

            return {
                name: strategyName,
                settings: [],
                timestamp: new Date().toISOString()
            };
        });
    }

    async openSettings(strategyIndex: number): Promise<StrategySettings | null> {
        const strategyContainer = document.querySelector(SELECTORS.strategies.container);
        if (!strategyContainer) return null;

        const strategyItems = strategyContainer.querySelectorAll(SELECTORS.strategies.items);
        if (strategyIndex >= strategyItems.length) return null;

        const strategyItem = strategyItems[strategyIndex];

        const buttonSelectors = [SELECTORS.strategies.settingsButton];

        let settingsButton: HTMLButtonElement | null = null;

        for (const selector of buttonSelectors) {
            settingsButton = strategyItem.querySelector(selector) as HTMLButtonElement;
            if (settingsButton) break;
        }

        if (!settingsButton) return null;

        settingsButton.focus();
        settingsButton.click();
        settingsButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        settingsButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        let dialog: Element | null = null;
        const maxAttempts = 15;
        const delayMs = 300;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, delayMs));

            const dialogSelectors = [SELECTORS.settingsDialog.container];

            for (const selector of dialogSelectors) {
                dialog = document.querySelector(selector);
                if (dialog) break;
            }

            if (dialog) break;
        }

        if (!dialog) return null;

        return this.extractDialogSettings(dialog);
    }

    private async extractDialogSettings(dialog: Element): Promise<StrategySettings | null> {
        const titleElement = dialog.querySelector(SELECTORS.settingsDialog.title);
        const dialogTitle = titleElement?.textContent?.trim();

        if (!dialogTitle) {
            throw new Error('Strategy dialog has no title - DOM structure may have changed');
        }
        const labels = dialog.querySelectorAll(SELECTORS.settingsDialog.inputLabels);
        const values = dialog.querySelectorAll(SELECTORS.settingsDialog.inputValues);

        const settings: Array<{ label: string; value: string; tooltip?: string }> = [];

        labels.forEach((label: Element, index: number) => {
            const labelText = label.textContent?.trim();
            const valueElement = values[index];

            if (!labelText || !valueElement) return;

            let value = '';
            if (valueElement instanceof HTMLInputElement) {
                if (valueElement.type === 'checkbox') {
                    value = valueElement.checked ? 'true' : 'false';
                } else {
                    const inputValue = valueElement.value?.trim();
                    if (inputValue === undefined) {
                        console.warn(`Input element has no value: ${labelText}`);
                        return;
                    }
                    value = inputValue;
                }
            } else if (valueElement instanceof HTMLSelectElement) {
                const selectValue = valueElement.value?.trim();
                if (selectValue === undefined) {
                    console.warn(`Select element has no value: ${labelText}`);
                    return;
                }
                value = selectValue;
            } else {
                const textValue = valueElement.textContent?.trim();
                if (textValue === undefined) {
                    console.warn(`Element has no text content: ${labelText}`);
                    return;
                }
                value = textValue;
            }

            if (value) {
                settings.push({ label: labelText, value });
            }
        });

        // Close dialog with multiple fallback methods
        await this.closeDialog(dialog);

        return { name: dialogTitle, settings, timestamp: new Date().toISOString() };
    }

    private async closeDialog(dialog: Element): Promise<void> {
        // Try multiple close button selectors
        const closeSelectors = [
            SELECTORS.settingsDialog.closeButton,
            'button[data-name="close"]',
            'button[aria-label="Close"]',
            '.close-button',
            '.dialog-close',
            'button[name="cancel"]',
            SELECTORS.settingsDialog.cancelButton
        ];

        for (const selector of closeSelectors) {
            const closeButton = dialog.querySelector(selector) as HTMLButtonElement;
            if (closeButton) {
                console.log(`Closing dialog using selector: ${selector}`);
                // Try multiple click methods for better compatibility
                closeButton.focus();
                closeButton.click();
                closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                // Give the dialog time to close
                await new Promise(resolve => setTimeout(resolve, 200));
                return;
            }
        }

        // Try to find any button with "close" or "cancel" text
        const allButtons = dialog.querySelectorAll('button');
        for (const button of Array.from(allButtons)) {
            const buttonText = button.textContent?.toLowerCase().trim();
            const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();

            // Skip buttons without text or aria-label
            if (!buttonText && !ariaLabel) continue;

            if (
                (buttonText && (buttonText.includes('close') || buttonText.includes('cancel'))) ||
                (ariaLabel && (ariaLabel.includes('close') || ariaLabel.includes('cancel')))
            ) {
                console.log(`Closing dialog using button: "${buttonText}" or aria-label: "${ariaLabel}"`);
                (button as HTMLButtonElement).focus();
                (button as HTMLButtonElement).click();
                (button as HTMLButtonElement).dispatchEvent(
                    new MouseEvent('click', { bubbles: true, cancelable: true })
                );

                // Give the dialog time to close
                await new Promise(resolve => setTimeout(resolve, 200));
                return;
            }
        }

        // Final fallback: try Escape key
        console.log('Attempting to close dialog using Escape key');
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        // Give the dialog time to close
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}
