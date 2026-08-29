import { firstMatching, locators } from './locators';
import type { DetectedStrategy, StrategyInput, TradingViewMetrics } from './types';

const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim();

export class TradingViewAdapter {
  detectStrategies(): DetectedStrategy[] {
    const found = new Map<string, DetectedStrategy>();
    for (const selector of locators.legendStrategySettingsButtons) {
      for (const button of document.querySelectorAll<HTMLElement>(selector)) {
        const container = button.closest('[data-name*="legend"], [class*="legend"], div');
        const text = normalise(container?.textContent ?? '');
        if (!text) continue;
        const name = text.replace(/Settings/gi, '').trim();
        if (name) found.set(name, { name });
      }
    }
    return [...found.values()];
  }

  async readStrategyInputs(strategyName: string): Promise<StrategyInput[]> {
    const button = this.#findSettingsButton(strategyName);
    if (!button) throw new Error('Could not find settings for strategy: ' + strategyName);
    button.click();

    const dialog = await this.#waitFor(() => firstMatching(document, locators.dialog));
    this.#activateInputsTab(dialog);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const inputs = this.#parseInputs(dialog);
    this.#closeDialog(dialog);
    return inputs;
  }

  async applyParameters(_strategyName: string, _parameters: Record<string, unknown>): Promise<void> {
    throw new Error('TradingView parameter application is the next implementation slice');
  }

  async readMetrics(): Promise<TradingViewMetrics> {
    throw new Error('TradingView Strategy Tester metric extraction is the next implementation slice');
  }

  getChartContext(): { symbol: string; timeframe: string } {
    const title = document.title;
    const symbol = title.split(' ')[0] || 'UNKNOWN';
    const intervalMatch = title.match(/(?:^|\s)(\d+[smhdwM]?)(?:\s|$)/i);
    return { symbol, timeframe: intervalMatch?.[1] ?? 'UNKNOWN' };
  }

  #findSettingsButton(strategyName: string): HTMLElement | null {
    for (const selector of locators.legendStrategySettingsButtons) {
      for (const button of document.querySelectorAll<HTMLElement>(selector)) {
        const container = button.closest('[data-name*="legend"], [class*="legend"], div');
        if (normalise(container?.textContent ?? '').includes(strategyName)) return button;
      }
    }
    return null;
  }

  #activateInputsTab(dialog: Element): void {
    const tabs = [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')];
    const inputsTab = tabs.find((tab) => /^inputs$/i.test(normalise(tab.textContent ?? '')));
    inputsTab?.click();
  }

  #parseInputs(dialog: Element): StrategyInput[] {
    const results: StrategyInput[] = [];
    const controls = dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input, select',
    );

    for (const [index, control] of [...controls].entries()) {
      if (control instanceof HTMLInputElement && control.type === 'hidden') continue;
      const row = control.closest('div');
      const rawLabel =
        control.getAttribute('aria-label') ??
        row?.querySelector('label')?.textContent ??
        control.getAttribute('name') ??
        'Input ' + (index + 1);
      const label = normalise(rawLabel);

      if (control instanceof HTMLSelectElement) {
        results.push({
          id: control.name || 'input-' + index,
          label,
          type: 'categorical',
          currentValue: control.value,
          options: [...control.options].map((option) => option.value),
        });
        continue;
      }

      if (control.type === 'checkbox') {
        results.push({
          id: control.name || 'input-' + index,
          label,
          type: 'boolean',
          currentValue: control.checked,
        });
        continue;
      }

      if (control.type === 'number') {
        const numeric = Number(control.value);
        results.push({
          id: control.name || 'input-' + index,
          label,
          type: Number.isInteger(numeric) && !control.value.includes('.') ? 'integer' : 'float',
          currentValue: numeric,
        });
        continue;
      }

      results.push({
        id: control.name || 'input-' + index,
        label,
        type: 'string',
        currentValue: control.value,
      });
    }
    return results;
  }

  #closeDialog(dialog: Element): void {
    const cancel = [...dialog.querySelectorAll<HTMLElement>('button')].find((button) =>
      /cancel|close/i.test(normalise(button.textContent ?? button.getAttribute('aria-label') ?? '')),
    );
    cancel?.click();
  }

  async #waitFor<T>(read: () => T | null, timeoutMs = 4_000): Promise<T> {
    const immediate = read();
    if (immediate) return immediate;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Timed out waiting for TradingView UI'));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const value = read();
        if (!value) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(value);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
}
