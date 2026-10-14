import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  evaluateOptimisationTrial,
  type OptimisationTrialAdapter,
} from '../lib/optimisation/trial-executor';
import type {
  CreateRun,
  NextTrial,
} from '../lib/protocol/types';

const config: CreateRun = {
  run_id: 'trial-timing-test',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 10,
  parameters: [
    {
      type: 'int',
      name: 'length',
      low: 5,
      high: 20,
      step: 1,
    },
  ],
  filters: [],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'signature',
  },
};

const trial: NextTrial = {
  run_id: config.run_id,
  trial_number: 3,
  parameters: {
    length: 14,
  },
};

describe('optimisation trial execution', () => {
  it('records phase timings without changing strategy metrics', async () => {
    const adapter = {
      assertRunContext: vi
        .fn()
        .mockResolvedValue(undefined),
      evaluateParameters: vi
        .fn()
        .mockResolvedValue({
          profitFactor: 1.75,
          totalTrades: 120,
        }),
    } satisfies OptimisationTrialAdapter;

    const result =
      await evaluateOptimisationTrial({
        adapter,
        strategyId: 'strategy-1',
        config,
        trial,
        originalParameters: {
          length: 14,
        },
      });

    expect(result.metrics.profitFactor).toBe(
      1.75,
    );
    expect(result.metrics.totalTrades).toBe(
      120,
    );
    expect(
      result.metrics['tvopt.contextPreMs'],
    ).toBeGreaterThanOrEqual(0);
    expect(
      result.metrics['tvopt.evaluationMs'],
    ).toBeGreaterThanOrEqual(0);
    expect(
      result.metrics['tvopt.contextPostMs'],
    ).toBeGreaterThanOrEqual(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      adapter.assertRunContext,
    ).toHaveBeenCalledTimes(2);
  });
});
