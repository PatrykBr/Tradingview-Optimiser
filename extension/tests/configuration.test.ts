import { describe, expect, it } from 'vitest';

import {
  buildBacktestRange,
  buildMetricFilters,
  DEFAULT_OPTIMISATION_FORM,
  formFromRun,
  parameterConfigsFromRun,
  parseTargetTrials,
} from '../components/optimiser/configuration';
import type { CreateRun } from '../lib/protocol/types';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'in_0',
    label: 'Length',
    type: 'integer',
    currentValue: 14,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    id: 'in_1',
    label: 'Filter',
    type: 'boolean',
    currentValue: true,
  },
];

const run: CreateRun = {
  run_id: 'run-1',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 250,
  parameters: [
    {
      type: 'int',
      name: 'in_0',
      low: 5,
      high: 30,
      step: 1,
      log: false,
    },
    {
      type: 'categorical',
      name: 'in_1',
      choices: [false, true],
    },
  ],
  filters: [
    {
      metric: 'maxDrawdownPercent',
      operator: 'lte',
      value: 8,
    },
    {
      metric: 'totalTrades',
      operator: 'gte',
      value: 100,
    },
  ],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'signature',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2024-01-01',
    end_date: '2025-01-01',
  },
};

describe('optimisation configuration', () => {
  it('restores the full form from a persisted run', () => {
    expect(formFromRun(run)).toEqual({
      objectiveMetric: 'profitFactor',
      targetTrials: '250',
      maxDrawdownFilter: {
        enabled: true,
        value: '8',
      },
      minProfitFactorFilter: {
        enabled: false,
        value: '1.3',
      },
      minTradesFilter: {
        enabled: true,
        value: '100',
      },
      dateRangeEnabled: true,
      startDate: '2024-01-01',
      endDate: '2025-01-01',
    });
  });

  it('restores parameter search-space settings from a run', () => {
    const configs = parameterConfigsFromRun(
      inputs,
      run,
    );

    expect(configs.in_0).toMatchObject({
      enabled: true,
      low: '5',
      high: '30',
      step: '1',
      log: false,
    });
    expect(configs.in_1).toMatchObject({
      enabled: true,
      choices: [false, true],
    });
  });

  it('builds filters and Deep Backtesting range from the form', () => {
    const form = formFromRun(run);

    expect(buildMetricFilters(form)).toEqual(
      run.filters,
    );
    expect(buildBacktestRange(form)).toEqual(
      run.backtest_range,
    );
  });

  it('validates trial counts and date ranges', () => {
    expect(parseTargetTrials('1000')).toBe(1000);
    expect(() => parseTargetTrials('0')).toThrow(
      /between 1 and 100,000/,
    );
    expect(() =>
      buildBacktestRange({
        ...DEFAULT_OPTIMISATION_FORM,
        dateRangeEnabled: true,
        startDate: '2025-01-01',
        endDate: '2024-01-01',
      }),
    ).toThrow(/start date must be before/);
  });
});
