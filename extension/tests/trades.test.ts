import { describe, expect, it } from 'vitest';

import { extractClosedTrades } from '../lib/tradingview/trades';

describe('TradingView closed-trade extraction', () => {
  it('extracts recognised trade PnL from nested trade containers', () => {
    const result = extractClosedTrades({
      performance: {
        tradeList: [
          {
            profit: 120,
            profitPercent: 1.2,
          },
          {
            profit: -60,
            profitPercent: -0.6,
          },
          {
            profit: 90,
            profitPercent: 0.9,
          },
        ],
      },
    });

    expect(result).toEqual({
      available: true,
      reason: null,
      trades: [
        {
          pnl: 120,
          pnlPercent: 1.2,
        },
        {
          pnl: -60,
          pnlPercent: -0.6,
        },
        {
          pnl: 90,
          pnlPercent: 0.9,
        },
      ],
    });
  });

  it('does not mistake arbitrary report arrays for trades', () => {
    const result = extractClosedTrades({
      performance: {
        rows: [
          { profit: 10 },
          { profit: -5 },
        ],
      },
      drawdown: [1, 2, 3],
    });

    expect(result.available).toBe(false);
    expect(result.trades).toEqual([]);
  });

  it('requires recognised PnL fields', () => {
    const result = extractClosedTrades({
      closedTrades: [
        { entry: 100, exit: 110 },
        { entry: 110, exit: 105 },
      ],
    });

    expect(result.available).toBe(false);
  });
});
