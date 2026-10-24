import { describe, expect, it, vi } from 'vitest';

import {
  evaluateOptimisationTrial,
  type OptimisationTrialAdapter,
} from '../lib/optimisation/study-trial-runner';
import type { CreateRun, NextTrial } from '../lib/protocol/types';

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
  it.each(['before', 'checking', 'evaluation', 'verification'])(
    'does not submit a result when cancelled during %s',
    async (phase) => {
      const controller = new AbortController();
      let checks = 0;
      const adapter = {
        assertRunContext: vi.fn(async () => {
          checks += 1;
          if ((phase === 'checking' && checks === 1) || (phase === 'verification' && checks === 2))
            controller.abort();
        }),
        evaluateParameters: vi.fn(async () => {
          if (phase === 'evaluation') controller.abort();
          return { profitFactor: 2 };
        }),
      };
      if (phase === 'before') controller.abort();
      await expect(
        evaluateOptimisationTrial({
          adapter,
          config,
          trial,
          strategyId: 'strategy-1',
          originalParameters: null,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      if (phase === 'before' || phase === 'checking')
        expect(adapter.evaluateParameters).not.toHaveBeenCalled();
    },
  );

  it('records phase timings without changing strategy metrics', async () => {
    const adapter = {
      assertRunContext: vi.fn().mockResolvedValue(undefined),
      evaluateParameters: vi.fn().mockResolvedValue({
        profitFactor: 1.75,
        totalTrades: 120,
      }),
    } satisfies OptimisationTrialAdapter;

    const result = await evaluateOptimisationTrial({
      adapter,
      strategyId: 'strategy-1',
      config,
      trial,
      originalParameters: {
        length: 14,
      },
    });

    expect(result.metrics.profitFactor).toBe(1.75);
    expect(result.metrics.totalTrades).toBe(120);
    expect(result.metrics['tvopt.contextPreMs']).toBeGreaterThanOrEqual(0);
    expect(result.metrics['tvopt.evaluationMs']).toBeGreaterThanOrEqual(0);
    expect(result.metrics['tvopt.contextPostMs']).toBeGreaterThanOrEqual(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(adapter.assertRunContext).toHaveBeenCalledTimes(2);
  });
});
