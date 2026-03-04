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
import { findListboxForCombobox, SELECTORS } from './selectors';
import { ensureBacktestingPanelOpen, simulatePointerClick } from './tradingview-dom';

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
  const ariaChecked = checkboxInput.getAttribute('aria-checked');
  const isChecked = ariaChecked !== null ? ariaChecked === 'true' : checkboxInput.checked;
  if (isChecked !== targetValue) {
    // Find the clickable wrapper
    const label = checkboxInput.closest('label') as HTMLElement;
    const wrapper = label?.querySelector('[class*="wrapper-"]') as HTMLElement;
    (wrapper ?? label)?.click();
  }
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

function isElementVisible(element: Element): boolean {
  const node = element as HTMLElement;

  if (node.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }

  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  return node.getClientRects().length > 0;
}

function getInnerText(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

function findSectionName(node: HTMLElement): string | null {
  const sectionHeader = node.querySelector('[data-qa-id^="property-dialog-item"]');
  if (!sectionHeader) return null;
  const name = sectionHeader.querySelector('[class*="title-"]')?.textContent?.trim() ?? '';
  return name || null;
}

function findNumericInputInCell(valueCell: HTMLElement): HTMLInputElement | null {
  const inputs = valueCell.querySelectorAll('input[data-qa-id="ui-lib-Input-input"]') as NodeListOf<HTMLInputElement>;
  for (const input of inputs) {
    const placeholder = input.getAttribute('placeholder') ?? '';
    if (placeholder.includes('YYYY')) continue;

    const inputMode = (input.getAttribute('inputmode') ?? '').toLowerCase();
    if (inputMode && inputMode !== 'numeric' && inputMode !== 'decimal') continue;

    const rawValue = input.value.trim();
    if (!rawValue) continue;
    if (!/^[-+]?(?:\d[\d,]*(\.\d+)?|\.\d+)$/.test(rawValue)) continue;

    return input;
  }

  return null;
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
 * Falls back to a table-row check if the snackbar never appears.
 */
async function waitForBacktestComplete(timeout = 30000): Promise<{ confirmed: boolean }> {
  const start = Date.now();

  // If Strategy Report is collapsed, open it right away to avoid waiting on a hidden panel.
  await ensureBacktestingPanelOpen({ timeoutMs: 1200 });

  // Phase 1: Wait for the loading snackbar to appear (TradingView started recalculating)
  // Give it up to 3s — if it never appears, the backtest might have been instant
  let snackbarSeen = false;
  const snackbarWaitLimit = 3000;
  while (Date.now() - start < snackbarWaitLimit) {
    const snackbar = document.querySelector('[data-qa-id="backtesting-loading-report-snackbar"]');
    if (snackbar) {
      snackbarSeen = true;
      break;
    }
    // Also check if data is already fresh (instant recalc)
    const panel = await ensureBacktestingPanelOpen({ timeoutMs: 250 });
    const rows = panel?.querySelectorAll('[data-qa-id="returns-summary-table"] tr.ka-row');
    if (rows && rows.length > 0 && !document.querySelector('[data-qa-id="backtesting-loading-report-snackbar"]')) {
      // No snackbar and rows exist — recalc may have been instant
      await sleep(200);
      if (!document.querySelector('[data-qa-id="backtesting-loading-report-snackbar"]')) {
        return { confirmed: true };
      }
    }
    await sleep(100);
  }

  // Phase 2: Wait for the snackbar to show success or disappear
  while (Date.now() - start < timeout) {
    const snackbar = document.querySelector('[data-qa-id="backtesting-loading-report-snackbar"]');

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
    } else {
      // No snackbar observed yet; ensure the report is open and treat existing table data as ready.
      const panel = await ensureBacktestingPanelOpen({ timeoutMs: 250 });
      const rows = panel?.querySelectorAll('[data-qa-id="returns-summary-table"] tr.ka-row');
      if (rows && rows.length > 0) {
        return { confirmed: true };
      }
    }

    await sleep(100);
  }

  // Timeout fallback — check if data exists anyway
  const panel = await ensureBacktestingPanelOpen({ timeoutMs: 500 });
  const rows = panel?.querySelectorAll('[data-qa-id="returns-summary-table"] tr.ka-row');
  if (rows && rows.length > 0) {
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
        const inlineGroups = Array.from(node.querySelectorAll(':scope > span[class*="inlineRow-"]')).filter(
          (entry): entry is HTMLElement => entry instanceof HTMLElement,
        );
        const groupsToParse = inlineGroups.length > 0 ? inlineGroups : [node];

        for (const group of groupsToParse) {
          const groupCells = Array.from(group.children).filter(
            (entry): entry is HTMLElement =>
              entry instanceof HTMLElement && entry.className.includes('cell-') && isElementVisible(entry),
          );

          for (let cellIndex = 0; cellIndex < groupCells.length - 1; cellIndex += 1) {
            const labelCell = groupCells[cellIndex];
            if (!labelCell.className.includes('first-')) continue;

            const valueCell = groupCells[cellIndex + 1];
            if (!valueCell || !valueCell.className.includes('cell-')) continue;

            const label = getInnerText(
              labelCell.querySelector(':scope > [class*="inner-"]') ?? labelCell.querySelector('[class*="inner-"]'),
            );
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
        const label = getInnerText(
          node.querySelector(':scope > [class*="inner-"]') ?? node.querySelector('[class*="inner-"]'),
        );
        if (!label) continue;

        let valueCellIndex = -1;
        for (let j = i + 1; j < directChildren.length; j += 1) {
          const candidate = directChildren[j];
          if (!isElementVisible(candidate)) continue;

          const candidateClass = candidate.className;
          if (
            candidateClass.includes('titleWrap-') ||
            candidateClass.includes('groupFooter-') ||
            candidateClass.includes('inlineRow-')
          ) {
            break;
          }
          if (!candidateClass.includes('cell-')) continue;
          if (candidateClass.includes('first-')) break;

          valueCellIndex = j;
          break;
        }

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
    submitBtn.click();

    // Wait for backtest to complete
    const { confirmed } = await waitForBacktestComplete();

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
