/**
 * Parameter Injector
 *
 * Opens the strategy settings dialog and sets parameter values
 * for a given trial. Uses anti-detection delays.
 *
 * H5: Matches parameters by label text (via labelToId) instead of fragile index counter.
 * C5: Uses generic class prefix selectors without hardcoded CSS hashes.
 * M13: Backtest completion timeout now warns and returns a flag.
 *
 * No per-parameter delays — anti-detection is applied between trials
 * by the service worker, not between individual field edits.
 */

import type { ContentScriptResponse } from '../shared/messages';
import type { TrialParams } from '../shared/types';
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
import { findListboxForCombobox, SELECTORS } from './selectors';
import { ensureBacktestingPanelOpen, simulatePointerClick } from './tradingview-dom';

const BACKTEST_SNACKBAR_SELECTOR = '[data-qa-id="backtesting-loading-report-snackbar"]';
const RETURNS_SUMMARY_ROWS_SELECTOR = '[data-qa-id="returns-summary-table"] tr.ka-row';

function queryBacktestSnackbar(): Element | null {
  return document.querySelector(BACKTEST_SNACKBAR_SELECTOR);
}

function getReturnsSummaryFingerprint(scope: ParentNode): string | null {
  const rows = scope.querySelectorAll(RETURNS_SUMMARY_ROWS_SELECTOR);
  if (rows.length === 0) {
    return null;
  }

  const normalized = Array.from(rows)
    .map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0)
    .join('|');

  return normalized.length > 0 ? normalized : null;
}

function getCurrentReturnsSummaryFingerprint(): string | null {
  const panel = document.querySelector(SELECTORS.backtestingPanel);
  if (!panel) {
    return null;
  }
  return getReturnsSummaryFingerprint(panel);
}

/**
 * Set a React-controlled input value using the native setter.
 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Toggle a checkbox by clicking its label wrapper.
 * M2: Check both aria-checked and native .checked.
 */
function toggleCheckbox(checkboxInput: HTMLInputElement, targetValue: boolean): void {
  const isChecked = getCheckboxCheckedState(checkboxInput);
  if (isChecked === targetValue) {
    return;
  }

  // Find the clickable wrapper
  const label = checkboxInput.closest('label');
  if (!(label instanceof HTMLElement)) {
    return;
  }

  const wrapper = label.querySelector('[class*="wrapper-"]');
  if (wrapper instanceof HTMLElement) {
    wrapper.click();
    return;
  }

  label.click();
}

/**
 * Open a custom combobox dropdown and select an option.
 */
async function selectDropdownOption(combobox: HTMLButtonElement, targetValue: string): Promise<void> {
  // Click to open
  combobox.click();
  await sleep(80);

  const listbox = findListboxForCombobox(combobox);

  if (!listbox) {
    throw new Error(`Could not find dropdown listbox for "${combobox.textContent}"`);
  }

  // Find the target option
  const options = listbox.querySelectorAll('[role="option"]');
  for (const option of options) {
    const text = option.textContent?.trim();
    if (text === targetValue) {
      (option as HTMLElement).click();
      return;
    }
  }

  // Close dropdown if option not found
  combobox.click();
  throw new Error(`Option "${targetValue}" not found in dropdown`);
}

/**
 * Wait for the settings dialog to appear.
 */
async function waitForDialog(timeout = 2500): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const dialog = document.querySelector(SELECTORS.strategyDialog) as HTMLElement;
    if (dialog) return dialog;
    await sleep(40);
  }
  throw new Error('Settings dialog did not appear within timeout');
}

function setNumericValue(input: HTMLInputElement, value: number): void {
  input.focus();
  input.select();
  setInputValue(input, String(value));
  input.blur();
}

/**
 * Open the strategy settings dialog for a specific strategy by index.
 * Uses PointerEvent sequence to click the hidden settings button.
 */
async function openSettingsDialog(strategyIndex: number): Promise<void> {
  const allItems = document.querySelectorAll(SELECTORS.legendSourceItem);
  const targetItem = allItems[strategyIndex] as HTMLElement | undefined;

  if (!targetItem) {
    throw new Error(`Strategy at index ${strategyIndex} not found.`);
  }

  const settingsButton = targetItem.querySelector(SELECTORS.legendSettingsAction) as HTMLButtonElement;
  if (!settingsButton) {
    throw new Error('Could not find strategy settings button');
  }

  simulatePointerClick(settingsButton);
  // Dialog opens asynchronously — waitForDialog handles the actual wait
}

/**
 * Wait for backtest recalculation to complete after clicking OK.
 * M13: Returns a boolean indicating whether completion was confirmed vs. timed out.
 *
 * Detection strategy (v3): TradingView shows a snackbar with
 * data-qa-id="backtesting-loading-report-snackbar".
 *   - While loading: contains text "Updating report"
 *   - When done: contains successIcon and "The report has been updated successfully"
 *   - Eventually the snackbar auto-dismisses
 *
 * We wait for the snackbar to appear (loading started), then wait for it to
 * either show the success state or disappear (both mean recalculation is done).
 * If snackbar never appears, we confirm completion from summary rows:
 * - Prefer changed text vs. the pre-submit snapshot when available.
 * - Fall back to any visible summary rows when no pre-submit snapshot exists.
 */
async function waitForBacktestComplete(
  beforeSubmitFingerprint: string | null,
  timeout = 30000,
): Promise<{ confirmed: boolean }> {
  const start = Date.now();

  // If Strategy Report is collapsed, open it right away to avoid waiting on a hidden panel.
  await ensureBacktestingPanelOpen({ timeoutMs: 1200 });

  const hasChangedSummaryRows = async (timeoutMs: number): Promise<boolean> => {
    const panel = await ensureBacktestingPanelOpen({ timeoutMs });
    if (!panel) {
      return false;
    }

    const currentFingerprint = getReturnsSummaryFingerprint(panel);
    if (!currentFingerprint) {
      return false;
    }
    if (!beforeSubmitFingerprint) {
      return true;
    }
    return currentFingerprint !== beforeSubmitFingerprint;
  };

  // Phase 1: Wait for the loading snackbar to appear (TradingView started recalculating)
  // Give it up to 3s — if it never appears, the backtest might have been instant
  let snackbarSeen = false;
  const snackbarWaitLimit = 3000;
  while (Date.now() - start < snackbarWaitLimit) {
    const snackbar = queryBacktestSnackbar();
    if (snackbar) {
      snackbarSeen = true;
      break;
    }
    // No snackbar path: only trust changed table content vs pre-submit snapshot.
    if (await hasChangedSummaryRows(250)) {
      return { confirmed: true };
    }
    await sleep(100);
    if (await hasChangedSummaryRows(250)) {
      return { confirmed: true };
    }
    if (queryBacktestSnackbar()) {
      snackbarSeen = true;
      break;
    }
    await sleep(100);
  }

  // Phase 2: Wait for the snackbar to show success or disappear
  while (Date.now() - start < timeout) {
    const snackbar = queryBacktestSnackbar();

    if (snackbar) {
      // Check for success indicator
      const hasSuccess = snackbar.querySelector('[class*="successIcon-"]') !== null;
      const text = snackbar.textContent ?? '';
      if (hasSuccess || text.includes('updated successfully')) {
        return { confirmed: true };
      }
      // Still loading — keep polling
    } else if (snackbarSeen) {
      // Snackbar was there but now it's gone — recalculation finished and snackbar auto-dismissed
      return { confirmed: true };
    } else if (await hasChangedSummaryRows(250)) {
      // Snackbar-less path: only accept changed summary data.
      return { confirmed: true };
    }

    await sleep(100);
  }

  // Timeout fallback — allow completion only if we can prove data changed.
  if (await hasChangedSummaryRows(500)) {
    return { confirmed: true };
  }

  console.warn('[TVO] Backtest completion detection timed out after %dms', timeout);
  return { confirmed: false };
}

/**
 * Inject parameters into the TradingView strategy settings.
 *
 * H5: Matches params by label-derived ID, not index counter.
 * C5: Uses generic [class*="content-"] selector without hardcoded hash.
 */
export async function injectParameters(
  params: TrialParams,
  _antiDetection: unknown,
  strategyIndex: number,
): Promise<ContentScriptResponse> {
  try {
    // Open dialog
    await openSettingsDialog(strategyIndex);
    const dialog = await waitForDialog();

    // Switch to Inputs tab
    const inputsTab = dialog.querySelector(SELECTORS.strategyInputsTab) as HTMLButtonElement;
    if (inputsTab && inputsTab.getAttribute('aria-selected') !== 'true') {
      inputsTab.click();
      await sleep(60);
    }

    const content = dialog.querySelector(SELECTORS.dialogContent) as HTMLElement;
    if (!content) {
      throw new Error('Could not find dialog content area');
    }

    let currentSection = '';
    const nextParamId = createScopedLabelIdAllocator();
    const directChildren = Array.from(content.children).filter((node): node is HTMLElement => node instanceof HTMLElement);

    // Walk rows in the same structural order as detector.ts so ID allocation stays aligned.
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

      // Inline row parameters (e.g. Take-Profit rows)
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

            const paramId = nextParamId(label, currentSection);
            const trialValue = params[paramId];
            if (typeof trialValue === 'number') {
              setNumericValue(numInput, trialValue);
            }
            cellIndex += 1;
          }
        }
        continue;
      }

      if (!classList.includes('cell-')) continue;

      // Checkbox
      if (classList.includes('fill-')) {
        const checkboxInput = node.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (!checkboxInput) continue;

        const checkboxLabel = getInnerText(node.querySelector('[class*="label-"]'));
        if (!checkboxLabel) continue;

        const paramId = nextParamId(checkboxLabel, currentSection);
        const trialValue = params[paramId];
        if (typeof trialValue === 'boolean') {
          toggleCheckbox(checkboxInput, trialValue);
        }
        continue;
      }

      // Standard two-cell rows: label (first) + value (next cell)
      if (classList.includes('first-')) {
        const label = getCellInnerLabelText(node);
        if (!label) continue;

        const valueCellIndex = findNextValueCellIndex(directChildren, i);
        if (valueCellIndex === -1) continue;
        const valueCell = directChildren[valueCellIndex];

        const paramId = nextParamId(label, currentSection);
        const trialValue = params[paramId];

        // Dropdown
        const combobox = valueCell.querySelector('button[role="combobox"]') as HTMLButtonElement | null;
        if (combobox) {
          if (typeof trialValue === 'string') {
            await selectDropdownOption(combobox, trialValue);
          }
          i = valueCellIndex;
          continue;
        }

        // Numeric input
        const numInput = findNumericInputInCell(valueCell);
        if (numInput) {
          if (typeof trialValue === 'number') {
            setNumericValue(numInput, trialValue);
          }
          i = valueCellIndex;
          continue;
        }
      }
    }

    // Click OK to apply — verify dialog is still open first
    const dialogStillOpen = document.querySelector(SELECTORS.strategyDialog);
    if (!dialogStillOpen) {
      throw new Error('Strategy settings dialog was closed during injection');
    }
    const submitBtn = dialog.querySelector('[data-qa-id="submit-button"]') as HTMLButtonElement;
    if (!submitBtn) {
      throw new Error('Could not find OK/Submit button');
    }
    const beforeSubmitFingerprint = getCurrentReturnsSummaryFingerprint();
    submitBtn.click();

    // Wait for backtest to complete
    const { confirmed } = await waitForBacktestComplete(beforeSubmitFingerprint);

    return {
      type: 'PARAMS_INJECTED',
      success: true,
      // M13: Surface the timeout warning so the service worker can decide
      ...(confirmed ? {} : { error: 'Backtest completion timed out — results may be stale' }),
    };
  } catch (err) {
    // Try to close dialog on error
    try {
      const cancelBtn = document.querySelector('button[name="cancel"]') as HTMLButtonElement;
      cancelBtn?.click();
    } catch {}

    return {
      type: 'PARAMS_INJECTED',
      success: false,
      error: err instanceof Error ? err.message : 'Parameter injection failed',
    };
  }
}
