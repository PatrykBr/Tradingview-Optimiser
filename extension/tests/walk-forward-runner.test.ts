import { describe, expect, it } from 'vitest';

import {
  runWalkForwardValidation,
  type WalkForwardBacktestAdapter,
} from '../lib/optimisation/walk-forward-runner';
import type {
  CreateRun,
  RunProgress,
} from '../lib/protocol/types';
import type {
  TradingViewBacktestRange,
} from '../lib/tradingview/adapter';

class FakeWalkForwardAdapter
  implements WalkForwardBacktestAdapter
{
  prepared: Array<
    TradingViewBacktestRange | null
  > = [];

  tested: Array<
    TradingViewBacktestRange | null
  > = [];

  async prepareBacktest(
    _strategyId: string,
    range: TradingViewBacktestRange | null,
  ) {
    this.prepared.push(range);
  }

  async evaluateParameters(
    _strategyId: string,
    _parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
  ) {
    this.tested.push(range);

    return {
      profitFactor: 1.6,
      maxDrawdownPercent: 4,
      totalTrades: 120,
    };
  }

  async assertRunContext() {}

  async applyParameters(
    _strategyId: string,
    parameters: Record<string, unknown>,
  ) {
    return parameters;
  }
}

const config: CreateRun = {
  run_id: 'parent',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 100,
  parameters: [
    {
      type: 'int',
      name: 'length',
      low: 5,
      high: 25,
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
    strategy_signature: 'sig',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2020-01-01',
    end_date: '2025-12-31',
  },
  research: {
    convergence: {
      enabled: false,
      min_trials: 50,
      patience: 30,
      min_improvement_percent: 1,
    },
    robustness: {
      enabled: false,
      full_range: null,
      validation_fraction: 0.3,
      folds: 3,
      top_candidates: 5,
    },
    stability: {
      enabled: false,
      perturbation_percent: 5,
    },
    walk_forward: {
      enabled: true,
      full_range: {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2025-12-31',
      },
      folds: 3,
      trials_per_fold: 20,
      initial_training_fraction: 0.5,
    },
    monte_carlo: {
      enabled: false,
      simulations: 5_000,
      confidence: 0.9,
    },
  },
};

const parentProgress: RunProgress = {
  run_id: 'parent',
  status: 'completed',
  completed_trials: 100,
  target_trials: 100,
  failed_trials: 0,
  best: {
    trial_number: 4,
    objective_value: 2,
    parameters: {
      length: 14,
    },
    metrics: {
      totalTrades: 200,
    },
    constraints: {},
  },
  trials: [],
};

describe('walk-forward runner', () => {
  it('fails unseen folds with a missing objective even when their filters pass', async () => {
    const adapter = new FakeWalkForwardAdapter();
    const result = await runWalkForwardValidation({
      adapter, strategyId: 'strategy-1',
      config: { ...config, objective_metric: 'sharpeRatio' },
      parentProgress, originalParameters: null,
      runStudy: async (child) => ({ ...parentProgress, run_id: child.run_id }),
    });
    expect(result.passedFolds).toBe(0);
    expect(result.folds.every((fold) => fold.testObjective === null)).toBe(true);
  });

  it('prepares every training range and evaluates every unseen fold', async () => {
    const adapter =
      new FakeWalkForwardAdapter();
    const childConfigs: CreateRun[] = [];

    const result =
      await runWalkForwardValidation({
        adapter,
        strategyId: 'strategy-1',
        config,
        parentProgress,
        originalParameters: {
          length: 14,
        },
        runStudy: async (
          child,
        ) => {
          childConfigs.push(child);

          return {
            run_id: child.run_id,
            status: 'completed',
            completed_trials: 20,
            target_trials: 20,
            failed_trials: 0,
            best: {
              trial_number: 2,
              objective_value: 2,
              parameters: {
                length:
                  12 +
                  childConfigs.length,
              },
              metrics: {},
              constraints: {},
            },
            trials: [],
          };
        },
      });

    expect(childConfigs).toHaveLength(3);
    expect(
      childConfigs.every(
        (child) =>
          child.target_trials === 20 &&
          child.research
            ?.walk_forward?.enabled ===
            false,
      ),
    ).toBe(true);
    expect(adapter.tested).toHaveLength(3);

    // Prepare training for each of the three folds, then restore the parent run.
    expect(adapter.prepared).toHaveLength(4);
    expect(result.passedFolds).toBe(3);
    expect(result.medianTestObjective).toBe(1.6);
  });
});
