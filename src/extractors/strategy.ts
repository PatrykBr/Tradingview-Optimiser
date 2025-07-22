import { SELECTORS } from '../config';
import type { StrategySettings } from '../types';

export class StrategyExtractor {
    extract(): StrategySettings[] {
        const strategyContainer = document.querySelector(SELECTORS.strategies.container);
        if (!strategyContainer) return [];

        const strategyItems = strategyContainer.querySelectorAll(SELECTORS.strategies.items);

        return Array.from(strategyItems).map((item, index) => {
            const titleElement = item.querySelector(SELECTORS.strategies.title);
            const strategyName = titleElement?.textContent?.trim() || `Strategy ${index + 1}`;

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
        const dialogTitle =
            dialog.querySelector(SELECTORS.settingsDialog.title)?.textContent?.trim() || 'Unknown Strategy';
        const labels = dialog.querySelectorAll(SELECTORS.settingsDialog.inputLabels);
        const values = dialog.querySelectorAll(SELECTORS.settingsDialog.inputValues);

        const settings: Array<{ label: string; value: string; tooltip?: string }> = [];

        labels.forEach((label: Element, index: number) => {
            const labelText = label.textContent?.trim();
            const valueElement = values[index];

            if (!labelText || !valueElement) return;

            let value = '';
            if (valueElement instanceof HTMLInputElement) {
                value =
                    valueElement.type === 'checkbox'
                        ? valueElement.checked
                            ? 'true'
                            : 'false'
                        : valueElement.value?.trim() || '';
            } else if (valueElement instanceof HTMLSelectElement) {
                value = valueElement.value?.trim() || '';
            } else {
                value = valueElement.textContent?.trim() || '';
            }

            if (value) {
                settings.push({ label: labelText, value });
            }
        });

        const closeButton =
            (dialog.querySelector(SELECTORS.settingsDialog.closeButton) as HTMLButtonElement) ||
            (dialog.querySelector('button[data-name="close"]') as HTMLButtonElement);
        closeButton?.click();

        return { name: dialogTitle, settings, timestamp: new Date().toISOString() };
    }
}
