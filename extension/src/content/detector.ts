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
  const parsed = Number.parseFloat(rawValue.replaceAll(',', ''));
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

function createCheckboxParam(
  label: string,
  section: string,
  currentValue: boolean,
  nextParamId: ReturnType<typeof createScopedLabelIdAllocator>,
): CheckboxParameter {
  return {
    id: nextParamId(label, section),
    label,
    section,
    type: 'checkbox',
    enabled: false,
    currentValue,
    optimize: false,
  };
}

function createDropdownParam(
  label: string,
  section: string,
  currentValue: string,
  options: string[],
  nextParamId: ReturnType<typeof createScopedLabelIdAllocator>,
): DropdownParameter {
  return {
    id: nextParamId(label, section),
    label,
    section,
    type: 'dropdown',
    enabled: false,
    currentValue,
    options,
    selectedOptions: [currentValue],
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

interface ParameterParseState {
  currentSection: string;
  nextParamId: ReturnType<typeof createScopedLabelIdAllocator>;
  params: StrategyParameter[];
  parsedMeta: ParsedParameterMeta[];
}

function pushParsedParameter(state: ParameterParseState, param: StrategyParameter, source: ParseSource): void {
  state.params.push(param);
  state.parsedMeta.push({
    source,
    section: param.section,
    label: param.label,
    type: param.type,
    fingerprint: buildParameterFingerprint(param),
  });
}

function getDialogContent(dialog: HTMLElement): HTMLElement | null {
  const content = dialog.querySelector(SELECTORS.dialogContent);
  return content instanceof HTMLElement ? content : null;
}

function getDialogContentChildren(content: HTMLElement): HTMLElement[] {
  return Array.from(content.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function parseInlineRowParameters(state: ParameterParseState, node: HTMLElement): void {
  const groupsToParse = resolveInlineGroups(node);
  for (const group of groupsToParse) {
    const groupCells = getVisibleCellChildren(group);
    for (let cellIndex = 0; cellIndex < groupCells.length - 1; cellIndex += 1) {
      const labelCell = groupCells[cellIndex];
      if (!labelCell.className.includes('first-')) continue;

      const valueCell = groupCells[cellIndex + 1];
      if (!valueCell?.className.includes('cell-')) continue;

      const label = getCellInnerLabelText(labelCell);
      if (!label) continue;

      const numInput = findNumericInputInCell(valueCell);
      if (!numInput) continue;

      const value = parseNumericInputValue(numInput.value);
      pushParsedParameter(
        state,
        createNumericParam(label, state.currentSection, value, state.nextParamId),
        'inline_numeric',
      );
      cellIndex += 1;
    }
  }
}

function parseCheckboxRowParameter(state: ParameterParseState, node: HTMLElement): void {
  const checkboxInput = node.querySelector('input[type="checkbox"]');
  if (!(checkboxInput instanceof HTMLInputElement)) {
    return;
  }

  const checkboxLabel = getInnerText(node.querySelector('[class*="label-"]'));
  if (!checkboxLabel) {
    return;
  }

  const isChecked = getCheckboxCheckedState(checkboxInput);
  pushParsedParameter(
    state,
    createCheckboxParam(checkboxLabel, state.currentSection, isChecked, state.nextParamId),
    'fill_checkbox',
  );
}

async function parseLabeledValueRowParameter(
  state: ParameterParseState,
  directChildren: HTMLElement[],
  index: number,
  node: HTMLElement,
): Promise<number> {
  const label = getCellInnerLabelText(node);
  if (!label) {
    return index + 1;
  }

  const valueCellIndex = findNextValueCellIndex(directChildren, index);
  if (valueCellIndex === -1) {
    return index + 1;
  }

  const valueCell = directChildren[valueCellIndex];
  const combobox = valueCell.querySelector('button[role="combobox"]');
  if (combobox instanceof HTMLButtonElement) {
    const currentValue = combobox.querySelector('[class*="middleSlot-"]')?.textContent?.trim() ?? '';
    const options = await scrapeDropdownOptions(combobox);
    const finalOptions = options.length > 0 ? options : [currentValue];
    pushParsedParameter(
      state,
      createDropdownParam(label, state.currentSection, currentValue, finalOptions, state.nextParamId),
      'first_dropdown',
    );
    return valueCellIndex + 1;
  }

  const numInput = findNumericInputInCell(valueCell);
  if (!numInput) {
    return index + 1;
  }

  const value = parseNumericInputValue(numInput.value);
  pushParsedParameter(
    state,
    createNumericParam(label, state.currentSection, value, state.nextParamId),
    'first_numeric',
  );
  return valueCellIndex + 1;
}

async function parseDialogNode(
  state: ParameterParseState,
  directChildren: HTMLElement[],
  index: number,
): Promise<number> {
  const node = directChildren[index];
  if (!isElementVisible(node)) {
    return index + 1;
  }

  const sectionName = findSectionName(node);
  if (sectionName) {
    state.currentSection = sectionName;
    return index + 1;
  }

  const classList = node.className;
  if (classList.includes('groupFooter-')) {
    return index + 1;
  }

  if (classList.includes('inlineRow-')) {
    parseInlineRowParameters(state, node);
    return index + 1;
  }

  if (!classList.includes('cell-')) {
    return index + 1;
  }

  if (classList.includes('fill-')) {
    parseCheckboxRowParameter(state, node);
    return index + 1;
  }

  if (!classList.includes('first-')) {
    return index + 1;
  }

  return parseLabeledValueRowParameter(state, directChildren, index, node);
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
  const state: ParameterParseState = {
    currentSection: '',
    nextParamId: createScopedLabelIdAllocator(),
    params: [],
    parsedMeta: [],
  };

  const content = getDialogContent(dialog);
  if (!content) {
    return state.params;
  }

  const directChildren = getDialogContentChildren(content);
  let index = 0;
  while (index < directChildren.length) {
    index = await parseDialogNode(state, directChildren, index);
  }

  logParameterDetectionSummary(state.params, state.parsedMeta);
  return state.params;
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
