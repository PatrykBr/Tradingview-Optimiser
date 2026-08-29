/**
 * Keep all TradingView-specific selectors here. Prefer accessibility semantics and
 * stable attributes. CSS class names are deliberately last-resort fallbacks.
 */
export const locators = {
  legendStrategySettingsButtons: [
    'button[aria-label*="Settings"]',
    '[data-name="legend-settings-action"]',
  ],
  dialog: ['[role="dialog"]'],
  inputsTab: [
    '[role="tab"][aria-label="Inputs"]',
    '[role="tab"]',
  ],
  dialogSubmit: [
    'button[data-name="submit-button"]',
    'button[type="submit"]',
  ],
  strategyTester: [
    '[data-name="strategy-tester"]',
    '[aria-label*="Strategy Tester"]',
  ],
} as const;

export function firstMatching(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}
