import { describe, expect, it } from 'vitest';

import { runTradeMonteCarlo } from '../lib/optimisation/monte-carlo';

const context = {
  source: 'oos' as const,
  range: {
    mode: 'deep' as const,
    start_date: '2024-01-01',
    end_date: '2024-12-31',
  },
};

describe('trade Monte Carlo', () => {
  it('is deterministic for the same trade sample', async () => {
    const snapshot = {
      available: true,
      reason: null,
      trades: [
        { pnl: 100 },
        { pnl: -50 },
        { pnl: 80 },
        { pnl: -30 },
        { pnl: 60 },
      ],
    };

    const first = await runTradeMonteCarlo(
      snapshot,
      1_000,
      0.9,
      context,
    );
    const second = await runTradeMonteCarlo(
      snapshot,
      1_000,
      0.9,
      context,
    );

    expect(first).toEqual(second);
    expect(first.available).toBe(true);
    expect(first.unit).toBe('pnl');
    expect(first.total).not.toBeNull();
    expect(first.maxDrawdown).not.toBeNull();
    expect(first.profitFactor).not.toBeNull();
  });

  it('reports unavailable trade data without inventing statistics', async () => {
    const result = await runTradeMonteCarlo(
      {
        available: false,
        trades: [],
        reason: 'No trade list',
      },
      5_000,
      0.9,
      context,
    );

    expect(result).toMatchObject({
      available: false,
      reason: 'No trade list',
      probabilityOfLoss: null,
      total: null,
      maxDrawdown: null,
      profitFactor: null,
    });
  });

  it('produces bounded loss probability and ordered intervals', async () => {
    const result = await runTradeMonteCarlo(
      {
        available: true,
        reason: null,
        trades: [
          { pnl: 20 },
          { pnl: 15 },
          { pnl: -10 },
          { pnl: 25 },
          { pnl: -8 },
          { pnl: 12 },
        ],
      },
      2_000,
      0.9,
      context,
    );

    expect(result.probabilityOfLoss).not.toBeNull();
    expect(result.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfLoss).toBeLessThanOrEqual(1);

    const total = result.total;
    if (!total) {
      throw new Error('Expected Monte Carlo total interval');
    }

    expect(total.low).toBeLessThanOrEqual(total.median);
    expect(total.median).toBeLessThanOrEqual(total.high);
  });
});
