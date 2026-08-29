import { describe, expect, it } from 'vitest';

import {
  buildStrategySignature,
  extractTradingViewMetrics,
  normalisePineInputs,
} from '../lib/tradingview/parsers';

describe('TradingView parser fixtures', () => {
  it('filters internal Pine metadata and keeps user-facing input metadata', () => {
    const parsed = normalisePineInputs(
      [
        { id: 'text', value: 'internal source' },
        { id: 'pineVersion', value: '6' },
        { id: 'in_0', value: true },
        { id: 'in_1', value: 14 },
        { id: 'in_2', value: 1.5 },
      ],
      [
        {
          id: 'in_0',
          name: 'Use trend filter',
          type: 'bool',
        },
        {
          id: 'in_1',
          name: 'ATR length',
          type: 'integer',
          min: 1,
          max: 100,
          step: 1,
        },
        {
          id: 'in_2',
          name: 'Risk',
          type: 'float',
          min: 0.1,
          max: 5,
          step: 0.1,
        },
      ],
    );

    expect(parsed).toEqual([
      {
        id: 'in_0',
        label: 'Use trend filter',
        type: 'boolean',
        currentValue: true,
      },
      {
        id: 'in_1',
        label: 'ATR length',
        type: 'integer',
        currentValue: 14,
        min: 1,
        max: 100,
        step: 1,
      },
      {
        id: 'in_2',
        label: 'Risk',
        type: 'float',
        currentValue: 1.5,
        min: 0.1,
        max: 5,
        step: 0.1,
      },
    ]);
  });

  it('extracts canonical and raw Strategy Tester metrics', () => {
    const metrics = extractTradingViewMetrics({
      performance: {
        all: {
          netProfit: 1200,
          netProfitPercent: 12.5,
          profitFactor: 1.8,
          totalTrades: 125,
          percentProfitable: 54,
          avgTrade: 9.6,
        },
        maxStrategyDrawDown: 400,
        maxStrategyDrawDownPercent: 4.2,
        sharpeRatio: 1.4,
        sortinoRatio: 2.1,
      },
    });

    expect(metrics).toMatchObject({
      netProfit: 1200,
      netProfitPercent: 12.5,
      profitFactor: 1.8,
      totalTrades: 125,
      maxDrawdown: 400,
      maxDrawdownPercent: 4.2,
      sharpeRatio: 1.4,
      sortinoRatio: 2.1,
      'tv.all.profitFactor': 1.8,
      'tv.performance.sharpeRatio': 1.4,
    });
  });

  it('normalises infinite TradingView ratios to finite JSON-safe values', () => {
    const metrics = extractTradingViewMetrics({
      performance: {
        all: {
          profitFactor: Number.POSITIVE_INFINITY,
          totalTrades: 10,
        },
      },
    });

    expect(metrics?.profitFactor).toBe(1.0e12);
  });

  it('changes strategy signature when the compiled input structure changes', () => {
    const baseInputs = normalisePineInputs(
      [{ id: 'in_0', value: 14 }],
      [{ id: 'in_0', name: 'Length', type: 'integer' }],
    );

    const changedInputs = normalisePineInputs(
      [
        { id: 'in_0', value: 14 },
        { id: 'in_1', value: true },
      ],
      [
        { id: 'in_0', name: 'Length', type: 'integer' },
        { id: 'in_1', name: 'Filter', type: 'bool' },
      ],
    );

    const a = buildStrategySignature(
      { pineVersion: '6' },
      { id: 'strategy@1' },
      'Strategy',
      baseInputs,
    );
    const b = buildStrategySignature(
      { pineVersion: '6' },
      { id: 'strategy@1' },
      'Strategy',
      changedInputs,
    );

    expect(a).not.toBe(b);
  });
});
