const NUMERIC_VALUE_REGEX = /^[-+]?(?:\d[\d,]*(\.\d+)?|\.\d+)$/;
const STOP_CLASS_TOKENS = ['titleWrap-', 'groupFooter-', 'inlineRow-'];

export function isElementVisible(element: Element): boolean {
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

export function getInnerText(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

export function findSectionName(node: HTMLElement): string | null {
  const sectionHeader = node.querySelector('[data-qa-id^="property-dialog-item"]');
  if (!sectionHeader) {
    return null;
  }

  const name = sectionHeader.querySelector('[class*="title-"]')?.textContent?.trim() ?? '';
  return name || null;
}

export function findNumericInputInCell(valueCell: HTMLElement): HTMLInputElement | null {
  const inputs = valueCell.querySelectorAll('input[data-qa-id="ui-lib-Input-input"]') as NodeListOf<HTMLInputElement>;

  for (const input of inputs) {
    const placeholder = input.getAttribute('placeholder') ?? '';
    if (placeholder.includes('YYYY')) {
      continue;
    }

    const inputMode = (input.getAttribute('inputmode') ?? '').toLowerCase();
    if (inputMode && inputMode !== 'numeric' && inputMode !== 'decimal') {
      continue;
    }

    const rawValue = input.value.trim();
    if (!rawValue) {
      continue;
    }

    if (!NUMERIC_VALUE_REGEX.test(rawValue)) {
      continue;
    }

    return input;
  }

  return null;
}

export function getCheckboxCheckedState(checkboxInput: HTMLInputElement): boolean {
  const ariaChecked = checkboxInput.getAttribute('aria-checked');
  if (ariaChecked !== null) {
    return ariaChecked === 'true';
  }

  return checkboxInput.checked;
}

export function getCellInnerLabelText(cell: HTMLElement): string {
  return getInnerText(cell.querySelector(':scope > [class*="inner-"]') ?? cell.querySelector('[class*="inner-"]'));
}

export function resolveInlineGroups(node: HTMLElement): HTMLElement[] {
  const inlineGroups = Array.from(node.querySelectorAll(':scope > span[class*="inlineRow-"]')).filter(
    (entry): entry is HTMLElement => entry instanceof HTMLElement,
  );

  if (inlineGroups.length > 0) {
    return inlineGroups;
  }

  return [node];
}

export function getVisibleCellChildren(group: HTMLElement): HTMLElement[] {
  return Array.from(group.children).filter(
    (entry): entry is HTMLElement =>
      entry instanceof HTMLElement && entry.className.includes('cell-') && isElementVisible(entry),
  );
}

export function findNextValueCellIndex(cells: HTMLElement[], startIndex: number): number {
  for (let index = startIndex + 1; index < cells.length; index += 1) {
    const candidate = cells[index];
    if (!isElementVisible(candidate)) {
      continue;
    }

    const candidateClass = candidate.className;
    if (
      STOP_CLASS_TOKENS.some(function hasStopToken(token): boolean {
        return candidateClass.includes(token);
      })
    ) {
      break;
    }

    if (!candidateClass.includes('cell-')) {
      continue;
    }

    if (candidateClass.includes('first-')) {
      break;
    }

    return index;
  }

  return -1;
}
