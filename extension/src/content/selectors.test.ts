import { describe, expect, it, vi } from 'vitest';
import { findListboxForCombobox, isTradingViewUrl } from './selectors';

function createCombobox(
  ariaControls: string | null,
  ownerDocument: Pick<Document, 'getElementById'>,
): HTMLButtonElement {
  return {
    getAttribute: (name: string) => (name === 'aria-controls' ? ariaControls : null),
    ownerDocument,
  } as unknown as HTMLButtonElement;
}

describe('isTradingViewUrl', () => {
  it('accepts tradingview hosts and rejects non-tradingview hosts', () => {
    expect(isTradingViewUrl('https://www.tradingview.com/chart/abc')).toBe(true);
    expect(isTradingViewUrl('https://uk.tradingview.com/super-chart/xyz')).toBe(true);
    expect(isTradingViewUrl('https://example.com/chart')).toBe(false);
    expect(isTradingViewUrl(undefined)).toBe(false);
  });
});

describe('findListboxForCombobox', () => {
  it('returns null when aria-controls is missing', () => {
    const ownerDocument = {
      getElementById: vi.fn(() => null),
    };
    const combobox = createCombobox(null, ownerDocument as unknown as Pick<Document, 'getElementById'>);

    expect(findListboxForCombobox(combobox)).toBeNull();
    expect(ownerDocument.getElementById).not.toHaveBeenCalled();
  });

  it('returns only role=listbox targets resolved by aria-controls id', () => {
    const listboxEl = {
      getAttribute: (name: string) => (name === 'role' ? 'listbox' : null),
    } as unknown as HTMLElement;
    const ownerDocument = {
      getElementById: vi.fn((id: string) => (id === 'target-listbox' ? listboxEl : null)),
    };
    const combobox = createCombobox('target-listbox', ownerDocument as unknown as Pick<Document, 'getElementById'>);

    expect(findListboxForCombobox(combobox)).toBe(listboxEl);
    expect(ownerDocument.getElementById).toHaveBeenCalledWith('target-listbox');
  });

  it('returns null when resolved element is not a listbox', () => {
    const nonListbox = {
      getAttribute: () => 'dialog',
    } as unknown as HTMLElement;
    const ownerDocument = {
      getElementById: vi.fn(() => nonListbox),
    };
    const combobox = createCombobox('menu-id', ownerDocument as unknown as Pick<Document, 'getElementById'>);

    expect(findListboxForCombobox(combobox)).toBeNull();
  });
});
