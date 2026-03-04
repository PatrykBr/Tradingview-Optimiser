import { isTradingViewChartPath, isTradingViewUrl as isTradingViewHostUrl } from '../shared/tradingview-url';

export const SELECTORS = {
  chartContainer: ['[class*="chart-container"]', '#tv-ui-root [class*="layout__area--center"]'],
  legendSourceItem: '[data-qa-id="legend-source-item"]',
  legendSettingsAction: '[data-qa-id="legend-settings-action"]',
  legendTitle: '[data-qa-id="title-wrapper legend-source-title"]',
  strategyDialog: '[data-name="indicator-properties-dialog"]',
  strategyInputsTab: '[data-qa-id="indicator-properties-dialog-tabs-inputs"]',
  dialogContent: '[class*="content-"]',
  backtestingPanel: '[class*="backtestingReport-"]',
  backtestingToggle: 'button[data-name="backtesting"]',
} as const;

export function isChartPage(): boolean {
  return (
    SELECTORS.chartContainer.some((selector) => document.querySelector(selector) !== null) ||
    isTradingViewChartPath(window.location.pathname)
  );
}

export function isTradingViewUrl(url: string | undefined): boolean {
  return isTradingViewHostUrl(url);
}

export function findListboxForCombobox(combobox: HTMLButtonElement): HTMLElement | null {
  const listboxId = combobox.getAttribute('aria-controls');
  if (listboxId) {
    const byId = document.getElementById(listboxId);
    if (byId) return byId;
  }

  const dialog = combobox.closest(SELECTORS.strategyDialog);
  if (dialog) {
    const scoped = dialog.ownerDocument.querySelector('[role="listbox"]') as HTMLElement | null;
    if (scoped) return scoped;
  }

  return document.querySelector('[role="listbox"]') as HTMLElement | null;
}
