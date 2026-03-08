/**
 * Parameter Detector
 *
 * Opens the strategy settings dialog and detects all parameters,
 * their types, current values, and valid ranges.
 */

import type { ContentScriptResponse } from '../shared/messages';
import type {
  CheckboxParameter,
  DropdownParameter,
  NumericParameter,
  StrategyInfo,
  StrategyParameter,
} from '../shared/types';
import { sleep } from '../utils/delay';
import { createScopedLabelIdAllocator } from '../utils/label';
import {
  findNextValueCellIndex,
  findNumericInputInCell,
  findSectionName,
  getCellInnerLabelText,
  getCheckboxCheckedState,
  getVisibleCellChildren,
  getInnerText,
  isElementVisible,
  resolveInlineGroups,
} from './parameter-dom';
import { findListboxForCombobox, isChartPage, SELECTORS } from './selectors';
import { simulatePointerClick } from './tradingview-dom';

type ParseSource = 'fill_checkbox' | 'first_dropdown' | 'first_numeric' | 'inline_numeric';

type ParsedParameterMeta = {
  source: ParseSource;
  section: string;
  label: string;
  type: StrategyParameter['type'];
  fingerprint: string;
};

/**
 * Get the strategy/indicator name from a legend source item.
 * The data-qa-id is "title-wrapper legend-source-title" (space-separated).
 */
function getStrategyName(item: Element): string {
  const titleEl = item.querySelector(SELECTORS.legendTitle);
  if (titleEl) {
    // The title element may contain child spans — grab only the first text-bearing child
    const firstTitle = titleEl.querySelector('[class*="title-"]');
    return firstTitle?.textContent?.trim() ?? titleEl.textContent?.trim() ?? 'Unknown Strategy';
  }
  // Fallback: try class-based selector
  const fallback = item.querySelector('[class*="title-"]');
  return fallback?.textContent?.trim() ?? 'Unknown Strategy';
}

/**
 * List all strategies/indicators found in the chart legend.
 */
export function listStrategies(): ContentScriptResponse {
  if (!isChartPage()) {
    return {
      type: 'ERROR',
      error: 'Not on a TradingView chart page. Navigate to a chart with a strategy loaded.',
    };
  }

  const items = document.querySelectorAll(SELECTORS.legendSourceItem);
  const strategies: StrategyInfo[] = [];

  items.forEach((item, index) => {
    // Only include items that have a settings button (strategies/indicators)
    const hasSettings = item.querySelector(SELECTORS.legendSettingsAction);
    if (hasSettings) {
      strategies.push({
        name: getStrategyName(item),
        index,
        isActive: !!item.querySelector('[class*="activeStrategy-"]'),
      });
    }
  });

  if (strategies.length === 0) {
    return {
      type: 'ERROR',
      error: 'No strategies found on the chart. Make sure a strategy is loaded.',
    };
  }

  return { type: 'STRATEGIES_LIST', strategies };
}

/**
 * Open the strategy settings dialog for a specific legend item by index.
 * Returns the strategy name.
 */
async function openSettingsDialog(strategyIndex: number): Promise<string> {
  const allItems = document.querySelectorAll(SELECTORS.legendSourceItem);
  const targetItem = allItems[strategyIndex] as HTMLElement | undefined;

  if (!targetItem) {
    throw new Error(`Strategy at index ${strategyIndex} not found. Re-scan strategies.`);
  }

  const settingsButton = targetItem.querySelector(SELECTORS.legendSettingsAction) as HTMLButtonElement;
  if (!settingsButton) {
    throw new Error('Could not find strategy settings button for the selected strategy.');
  }

  const strategyName = getStrategyName(targetItem);

  simulatePointerClick(settingsButton);
  await sleep(500); // Wait for dialog to open

  return strategyName;
}

/**
 * Wait for the settings dialog to appear in the DOM.
 */
async function waitForDialog(timeout = 5000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const dialog = document.querySelector(SELECTORS.strategyDialog) as HTMLElement;
    if (dialog) return dialog;
    await sleep(100);
  }
  throw new Error('Settings dialog did not appear within timeout');
}

/**
 * Ensure the Inputs tab is active.
 */
async function switchToInputsTab(dialog: HTMLElement): Promise<void> {
  const inputsTab = dialog.querySelector(SELECTORS.strategyInputsTab) as HTMLButtonElement;
  if (inputsTab && inputsTab.getAttribute('aria-selected') !== 'true') {
    inputsTab.click();
    await sleep(200);
  }
}

/**
 * M1: Open a dropdown combobox, scrape all available options, then close it.
 */
async function scrapeDropdownOptions(combobox: HTMLButtonElement): Promise<string[]> {
  const options: string[] = [];

  // Open the dropdown
  combobox.click();
  await sleep(300);

  const listbox = findListboxForCombobox(combobox);

  if (listbox) {
    const optionEls = listbox.querySelectorAll('[role="option"]');
    for (const opt of optionEls) {
      const text = opt.textContent?.trim();
      if (text) options.push(text);
    }
  }

  // Close the dropdown by clicking the combobox again
  combobox.click();
  await sleep(200);

  return options;
}

function parseNumericInputValue(rawValue: string): number {
  const parsed = parseFloat(rawValue.replace(/,/g, ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveNumericBounds(value: number): { min: number; max: number; step: number } {
  const isInteger = Number.isInteger(value);
  const step = isInteger ? 1 : 0.1;

  if (value === 0) {
    return {
      min: isInteger ? -10 : -1,
      max: isInteger ? 10 : 1,
      step,
    };
  }

  let min = Math.floor(value * 0.5);
  let max = Math.ceil(value * 2);
  if (min === max) {
    min = value - (isInteger ? 1 : 0.1);
    max = value + (isInteger ? 1 : 0.1);
  }

  return { min, max, step };
}

function createNumericParam(
  label: string,
  section: string,
  value: number,
  nextParamId: ReturnType<typeof createScopedLabelIdAllocator>,
): NumericParameter {
  const { min, max, step } = resolveNumericBounds(value);
  return {
    id: nextParamId(label, section),
    label,
    section,
    type: 'numeric',
    enabled: true,
    currentValue: value,
    min,
    max,
    step,
  };
}

function buildParameterFingerprint(param: StrategyParameter): string {
  const base = `${param.section}::${param.label}::${param.type}::${param.enabled}`;

  switch (param.type) {
    case 'numeric':
      return `${base}::${param.currentValue}::${param.min}::${param.max}::${param.step}`;
    case 'checkbox':
      return `${base}::${param.currentValue}::${param.optimize}`;
    case 'dropdown':
      return `${base}::${param.currentValue}::${param.options.join('|')}::${param.selectedOptions.join('|')}`;
  }
}

function logParameterDetectionSummary(params: StrategyParameter[], meta: ParsedParameterMeta[]): void {
  const sectionCounts = new Map<string, number>();
  for (const param of params) {
    sectionCounts.set(param.section, (sectionCounts.get(param.section) ?? 0) + 1);
  }

  const sectionSummary = Array.from(sectionCounts.entries()).map(([section, count]) => ({
    section: section || 'General',
    count,
  }));

  const duplicateByFingerprint = new Map<
    string,
    { count: number; label: string; section: string; type: StrategyParameter['type']; sources: Set<ParseSource> }
  >();
  for (const item of meta) {
    const existing = duplicateByFingerprint.get(item.fingerprint);
    if (existing) {
      existing.count += 1;
      existing.sources.add(item.source);
      continue;
    }
    duplicateByFingerprint.set(item.fingerprint, {
      count: 1,
      label: item.label,
      section: item.section,
      type: item.type,
      sources: new Set([item.source]),
    });
  }

  const duplicates = Array.from(duplicateByFingerprint.values())
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      section: entry.section || 'General',
      label: entry.label,
      type: entry.type,
      count: entry.count,
      sources: Array.from(entry.sources).join(', '),
    }));

  console.info('[TVO] [Detector] Parameter parse summary', {
    total: params.length,
    sections: sectionSummary.length,
    sectionSummary,
  });
  if (duplicates.length > 0) {
    console.warn('[TVO] [Detector] Duplicate parameter candidates detected', duplicates);
  }
}

/**
 * Parse all parameters from the settings dialog.
 *
 * Fixes applied:
 * - C5: Use `[class*="content-"]` without hardcoded hash suffix
 * - H5: Use label-based IDs instead of fragile paramIndex counter
 * - M1: Open dropdowns to scrape all available options
 * - M2: Check both aria-checked AND .checked for checkbox state
 */
async function parseParameters(dialog: HTMLElement): Promise<StrategyParameter[]> {
  const params: StrategyParameter[] = [];
  const parsedMeta: ParsedParameterMeta[] = [];
  const nextParamId = createScopedLabelIdAllocator();

  function pushParam(param: StrategyParameter, source: ParseSource): void {
    params.push(param);
    parsedMeta.push({
      source,
      section: param.section,
      label: param.label,
      type: param.type,
      fingerprint: buildParameterFingerprint(param),
    });
  }

  // C5: Remove hardcoded RLntasnw hash — just match the content- prefix
  const content = dialog.querySelector(SELECTORS.dialogContent) as HTMLElement;
  if (!content) return params;

  let currentSection = '';
  const directChildren = Array.from(content.children).filter((node): node is HTMLElement => node instanceof HTMLElement);

  for (let i = 0; i < directChildren.length; i += 1) {
    const node = directChildren[i];
    if (!isElementVisible(node)) continue;

    const sectionName = findSectionName(node);
    if (sectionName) {
      currentSection = sectionName;
      continue;
    }

    const classList = node.className;
    if (classList.includes('groupFooter-')) continue;

    // Inline row parameters (e.g. Take-Profit, date range rows)
    if (classList.includes('inlineRow-')) {
      const groupsToParse = resolveInlineGroups(node);

      for (const group of groupsToParse) {
        const groupCells = getVisibleCellChildren(group);

        for (let cellIndex = 0; cellIndex < groupCells.length - 1; cellIndex += 1) {
          const labelCell = groupCells[cellIndex];
          if (!labelCell.className.includes('first-')) continue;

          const valueCell = groupCells[cellIndex + 1];
          if (!valueCell || !valueCell.className.includes('cell-')) continue;

          const label = getCellInnerLabelText(labelCell);
          if (!label) continue;

          const numInput = findNumericInputInCell(valueCell);
          if (!numInput) continue;

          const value = parseNumericInputValue(numInput.value);
          pushParam(createNumericParam(label, currentSection, value, nextParamId), 'inline_numeric');
          cellIndex += 1;
        }
      }
      continue;
    }

    if (!classList.includes('cell-')) continue;

    // Checkbox rows in fill cells
    if (classList.includes('fill-')) {
      const checkboxInput = node.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!checkboxInput) continue;

      const checkboxLabel = getInnerText(node.querySelector('[class*="label-"]'));
      if (!checkboxLabel) continue;

      // M2: Check both aria-checked and the native .checked property
      const isChecked = getCheckboxCheckedState(checkboxInput);

      pushParam(
        {
          id: nextParamId(checkboxLabel, currentSection),
          label: checkboxLabel,
          section: currentSection,
          type: 'checkbox',
          enabled: false,
          currentValue: isChecked,
          optimize: false,
        } as CheckboxParameter,
        'fill_checkbox',
      );
      continue;
    }

    // Standard two-cell rows: label (first) + value (next cell)
    if (classList.includes('first-')) {
      const label = getCellInnerLabelText(node);
      if (!label) continue;

      const valueCellIndex = findNextValueCellIndex(directChildren, i);
      if (valueCellIndex === -1) continue;
      const valueCell = directChildren[valueCellIndex];

      // Dropdown
      const combobox = valueCell.querySelector('button[role="combobox"]') as HTMLButtonElement | null;
      if (combobox) {
        const currentValue = combobox.querySelector('[class*="middleSlot-"]')?.textContent?.trim() ?? '';
        const options = await scrapeDropdownOptions(combobox);
        const finalOptions = options.length > 0 ? options : [currentValue];

        pushParam(
          {
            id: nextParamId(label, currentSection),
            label,
            section: currentSection,
            type: 'dropdown',
            enabled: false,
            currentValue,
            options: finalOptions,
            selectedOptions: [currentValue],
          } as DropdownParameter,
          'first_dropdown',
        );
        i = valueCellIndex;
        continue;
      }

      // Numeric
      const numInput = findNumericInputInCell(valueCell);
      if (numInput) {
        const value = parseNumericInputValue(numInput.value);
        pushParam(createNumericParam(label, currentSection, value, nextParamId), 'first_numeric');
        i = valueCellIndex;
      }
    }
  }

  logParameterDetectionSummary(params, parsedMeta);
  return params;
}

/**
 * Close the settings dialog without saving.
 */
async function closeDialog(): Promise<void> {
  const cancelBtn = document.querySelector('button[name="cancel"]') as HTMLButtonElement;
  if (cancelBtn) {
    cancelBtn.click();
    await sleep(200);
  }
}

/**
 * Main entry point: detect all strategy parameters for a specific strategy.
 */
export async function detectParameters(strategyIndex: number): Promise<ContentScriptResponse> {
  try {
    // L11: Guard against non-chart pages
    if (!isChartPage()) {
      return {
        type: 'ERROR',
        error: 'Not on a TradingView chart page. Navigate to a chart with a strategy loaded.',
      };
    }

    const strategyName = await openSettingsDialog(strategyIndex);
    const dialog = await waitForDialog();
    await switchToInputsTab(dialog);
    await sleep(300); // Let the tab content render

    const parameters = await parseParameters(dialog);
    await closeDialog();

    if (parameters.length === 0) {
      return { type: 'ERROR', error: 'No parameters found in the strategy settings dialog' };
    }

    return {
      type: 'PARAMS_DETECTED',
      parameters,
      strategyName,
    };
  } catch (err) {
    // Try to close dialog on error
    try {
      await closeDialog();
    } catch {}
    return {
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Parameter detection failed',
    };
  }
}
