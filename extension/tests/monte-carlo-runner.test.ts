import { describe, expect, it, vi } from 'vitest';

import {
  runMonteCarloValidation,
  type MonteCarloBacktestAdapter,
} from '../lib/optimisation/monte-carlo-runner';
import type {
  CreateRun,
  RunProgress,
} from '../lib/protocol/types';
import type {
  TradingViewBacktestRange,
} from '../lib/tradingview/adapter';

class FakeMonteCarloAdapter
  implements MonteCarloBacktestAdapter
{
  evaluatedRange:
    | TradingViewBacktestRange
    | null = null;

  async evaluateParameters(
    _strategyId: string,
    _parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
  ) {
    this.evaluatedRange = range;
    return {
      profitFactor: 1.7,
    };
  }

  async assertRunContext() {}

  async readClosedTrades() {
    return {
      available: true,
      reason: null,
      trades: [
        { pnl: 100 },
        { pnl: -40 },
        { pnl: 80 },
        { pnl: -20 },
        { pnl: 60 },
      ],
    };
  }

  async prepareBacktest() {}

  async applyParameters(
    _strategyId: string,
    parameters: Record<string, unknown>,
  ) {
    return parameters;
  }
}

const config: CreateRun = {
  run_id: 'run-1',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 100,
  parameters: [],
  filters: [],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'sig',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2020-01-01',
    end_date: '2023-12-31',
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
        end_date: '2025-12-31',
      },
      validation_fraction: 0.3,
      folds: 2,
      top_candidates: 3,
    },
    stability: {
      enabled: false,
      perturbation_percent: 5,
    },
    monte_carlo: {
      enabled: true,
      simulations: 1_000,
      confidence: 0.9,
    },
  },
};

const progress: RunProgress = {
  run_id: 'run-1',
  status: 'completed',
  completed_trials: 100,
  target_trials: 100,
  failed_trials: 0,
  best: {
    trial_number: 1,
    objective_value: 2,
    parameters: {
      length: 14,
    },
    metrics: {},
    constraints: {},
  },
  trials: [],
};

describe('Monte Carlo runner', () => {
  it('preserves cancellation when restoring TradingView also fails', async () => {
    const adapter = new FakeMonteCarloAdapter();
    const controller = new AbortController();
    vi.spyOn(adapter, 'readClosedTrades').mockImplementation(async () => {
      controller.abort();
      return { available: true, reason: null, trades: [{ pnl: 10 }, { pnl: -5 }] };
    });
    vi.spyOn(adapter, 'prepareBacktest').mockRejectedValue(new Error('restore failed'));
    await expect(runMonteCarloValidation({
      adapter, config, progress, strategyId: 'strategy-1', originalParameters: null,
      existingResearch: {}, signal: controller.signal,
    })).rejects.toThrow(/Operation aborted.*restore failed/);
  });

  it('uses the reserved unseen range when robustness results exist', async () => {
    const adapter =
      new FakeMonteCarloAdapter();

    const result =
      await runMonteCarloValidation({
        adapter,
        strategyId: 'strategy-1',
        config,
        progress,
        originalParameters: null,
        existingResearch: {
          robustness: {
            trainingRange: {
              mode: 'deep',
              start_date: '2020-01-01',
              end_date: '2023-12-31',
            },
            validationWindows: [
              {
                index: 0,
                startDate: '2024-01-01',
                endDate: '2024-12-31',
              },
              {
                index: 1,
                startDate: '2025-01-01',
                endDate: '2025-12-31',
              },
            ],
            candidates: [],
            winnerTrialNumber: 1,
            winnerParameters: {
              length: 14,
            },
          },
        },
      });

    expect(adapter.evaluatedRange).toEqual({
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    });
    expect(result.available).toBe(true);
    expect(result.source).toBe('oos');
    expect(result.sampleSize).toBe(5);
  });
});
