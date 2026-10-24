import { describe, expect, it } from 'vitest';

import {
  runResearchValidation,
  type ResearchBacktestAdapter,
} from '../lib/optimisation/research-runner';
import type {
  CreateRun,
  RunProgress,
} from '../lib/protocol/types';
import type {
  TradingViewBacktestRange,
} from '../lib/tradingview/adapter';

class FakeResearchAdapter
  implements ResearchBacktestAdapter
{
  readonly evaluations: Array<{
    parameters: Record<string, unknown>;
    range: TradingViewBacktestRange | null;
  }> = [];

  readonly prepared:
    Array<TradingViewBacktestRange | null> = [];

  readonly applied:
    Array<Record<string, unknown>> = [];

  failRestore = false;

  async assertRunContext(): Promise<void> {}

  async evaluateParameters(
    _strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
  ): Promise<Record<string, number>> {
    this.evaluations.push({
      parameters,
      range,
    });

    return {
      profitFactor: 1.8,
      maxDrawdownPercent: 4,
      totalTrades: 120,
    };
  }

  async prepareBacktest(
    _strategyId: string,
    range: TradingViewBacktestRange | null,
  ): Promise<void> {
    if (this.failRestore) {
      throw new Error(
        'restore failed',
      );
    }

    this.prepared.push(range);
  }

  async applyParameters(
    _strategyId: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.applied.push(parameters);
    return parameters;
  }
}

const config: CreateRun = {
  run_id: 'research-run',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 20,
  parameters: [
    {
      type: 'int',
      name: 'length',
      low: 5,
      high: 30,
      step: 1,
    },
  ],
  filters: [
    {
      metric: 'maxDrawdownPercent',
      operator: 'lte',
      value: 8,
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
    start_date: '2020-01-01',
    end_date: '2022-06-30',
  },
  research: {
    convergence: {
      enabled: false,
      min_trials: 50,
      patience: 30,
      min_improvement_percent: 1,
    },
    robustness: {
      enabled: true,
      full_range: {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2024-12-31',
      },
      validation_fraction: 0.5,
      folds: 1,
      top_candidates: 1,
    },
    stability: {
      enabled: false,
      perturbation_percent: 5,
    },
  },
};

const progress: RunProgress = {
  run_id: 'research-run',
  status: 'completed',
  completed_trials: 1,
  target_trials: 20,
  failed_trials: 0,
  best: {
    trial_number: 0,
    objective_value: 2.4,
    parameters: {
      length: 14,
    },
    metrics: {
      profitFactor: 2.4,
    },
    constraints: {},
  },
  trials: [
    {
      trial_number: 0,
      state: 'complete',
      objective_value: 2.4,
      parameters: {
        length: 14,
      },
      metrics: {
        profitFactor: 2.4,
      },
      constraints: {},
      failure_reason: null,
      duration_ms: 100,
    },
  ],
};

describe('research runner', () => {
  it('runs OOS validation and restores the optimisation chart state', async () => {
    const adapter =
      new FakeResearchAdapter();

    const result =
      await runResearchValidation({
        adapter,
        strategyId: 'strategy-1',
        config,
        progress,
        originalParameters: {
          length: 14,
        },
      });

    expect(
      result.robustness
        ?.winnerTrialNumber,
    ).toBe(0);
    expect(
      result.robustness
        ?.candidates[0]
        ?.validationObjective,
    ).toBe(1.8);
    expect(
      adapter.evaluations,
    ).toHaveLength(1);
    expect(
      adapter.prepared,
    ).toEqual([
      {
        startDate: '2020-01-01',
        endDate: '2022-06-30',
      },
    ]);
    expect(adapter.applied).toEqual([
      {
        length: 14,
      },
    ]);
  });

  it('reports restoration failure after otherwise successful validation', async () => {
    const adapter =
      new FakeResearchAdapter();
    adapter.failRestore = true;

    await expect(
      runResearchValidation({
        adapter,
        strategyId: 'strategy-1',
        config,
        progress,
        originalParameters: {
          length: 14,
        },
      }),
    ).rejects.toThrow('restore failed');
  });
});
