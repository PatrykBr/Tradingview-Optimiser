import { describe, expect, it } from 'vitest';
import { isTradingViewUrl } from './selectors';

describe('isTradingViewUrl', () => {
  it('accepts tradingview hosts and rejects non-tradingview hosts', () => {
    expect(isTradingViewUrl('https://www.tradingview.com/chart/abc')).toBe(true);
    expect(isTradingViewUrl('https://uk.tradingview.com/super-chart/xyz')).toBe(true);
    expect(isTradingViewUrl('https://example.com/chart')).toBe(false);
    expect(isTradingViewUrl(undefined)).toBe(false);
  });
});
