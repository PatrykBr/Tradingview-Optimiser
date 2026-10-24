import { describe, expect, it, vi } from 'vitest';
import {
  runResearchValidation,
  type ResearchBacktestAdapter,
} from '../lib/optimisation/research-runner';
import type { CreateRun, RunProgress } from '../lib/protocol/types';
import type { TradingViewBacktestRange } from '../lib/tradingview/adapter';

class FakeResearchAdapter implements ResearchBacktestAdapter {
  readonly evaluations: Array<{
    parameters: Record<string, unknown>;
    range: TradingViewBacktestRange | null;
  }> = [];
  readonly prepared: Array<TradingViewBacktestRange | null> = [];
  readonly applied: Array<Record<string, unknown>> = [];
  failRestore = false;
  async assertRunContext() {}
  async evaluateParameters(
    _strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
  ) {
    this.evaluations.push({ parameters, range });
    return { profitFactor: 1.8, maxDrawdownPercent: 4, totalTrades: 120 };
  }
  async prepareBacktest(_strategyId: string, range: TradingViewBacktestRange | null) {
    if (this.failRestore) throw new Error('restore failed');
    this.prepared.push(range);
  }
  async applyParameters(_strategyId: string, parameters: Record<string, unknown>) {
    this.applied.push(parameters);
    return parameters;
  }
  async readClosedTrades() {
    return {
      available: true,
      reason: null,
      trades: [{ pnl: 100 }, { pnl: -40 }, { pnl: 80 }, { pnl: -20 }, { pnl: 60 }],
    };
  }
}

const config: CreateRun = {
  run_id: 'research-run',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 20,
  parameters: [{ type: 'int', name: 'length', low: 5, high: 30, step: 1 }],
  filters: [{ metric: 'maxDrawdownPercent', operator: 'lte', value: 8 }],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'signature',
  },
  backtest_range: { mode: 'deep', start_date: '2020-01-01', end_date: '2022-06-30' },
  research: {
    convergence: { enabled: false, min_trials: 50, patience: 30, min_improvement_percent: 1 },
    robustness: {
      enabled: true,
      full_range: { mode: 'deep', start_date: '2020-01-01', end_date: '2024-12-31' },
      validation_fraction: 0.5,
      folds: 1,
      top_candidates: 1,
    },
    stability: { enabled: false, perturbation_percent: 5 },
  },
};
const progress: RunProgress = {
  run_id: config.run_id,
  status: 'completed',
  completed_trials: 1,
  target_trials: 20,
  failed_trials: 0,
  best: {
    trial_number: 0,
    objective_value: 2.4,
    parameters: { length: 14 },
    metrics: { profitFactor: 2.4 },
    constraints: {},
  },
  trials: [
    {
      trial_number: 0,
      state: 'complete',
      objective_value: 2.4,
      parameters: { length: 14 },
      metrics: { profitFactor: 2.4 },
      constraints: {},
      failure_reason: null,
      duration_ms: 100,
    },
  ],
};
const request = (adapter = new FakeResearchAdapter()) => ({
  adapter,
  config: structuredClone(config),
  progress,
  strategyId: 'strategy-1',
  originalParameters: { length: 14 },
});
const enableWalkForward = (run: CreateRun) => {
  run.research!.walk_forward = {
    enabled: true,
    full_range: config.research!.robustness.full_range!,
    folds: 3,
    trials_per_fold: 20,
    initial_training_fraction: 0.5,
  };
};
const enableMonteCarlo = (run: CreateRun) => {
  run.research!.monte_carlo = { enabled: true, simulations: 1_000, confidence: 0.9 };
};
const runStudy = vi.fn(async (child: CreateRun): Promise<RunProgress> => ({
  ...progress,
  run_id: child.run_id,
  target_trials: child.target_trials,
  completed_trials: child.target_trials,
}));

describe('research workflow', () => {
  it('runs OOS validation and restores the optimisation chart state', async () => {
    const run = request();
    const result = await runResearchValidation(run);
    expect(result.robustness?.winnerTrialNumber).toBe(0);
    expect(result.robustness?.candidates[0]?.validationObjective).toBe(1.8);
    expect(run.adapter.evaluations).toHaveLength(1);
    expect(run.adapter.prepared).toEqual([{ startDate: '2020-01-01', endDate: '2022-06-30' }]);
    expect(run.adapter.applied).toEqual([{ length: 14 }]);
  });

  it('reports restoration failure after otherwise successful validation', async () => {
    const run = request();
    run.adapter.failRestore = true;
    await expect(runResearchValidation(run)).rejects.toThrow('restore failed');
  });

  it('prepares each training range, evaluates unseen folds and restores once', async () => {
    const run = request();
    run.config.research!.robustness.enabled = false;
    enableWalkForward(run.config);
    const children: CreateRun[] = [];
    const result = await runResearchValidation({
      ...run,
      runStudy: async (child) => {
        children.push(child);
        return { ...progress, run_id: child.run_id, completed_trials: 20 };
      },
    });
    expect(children).toHaveLength(3);
    expect(
      children.every((child) => child.target_trials === 20 && child.research === undefined),
    ).toBe(true);
    expect(run.adapter.evaluations).toHaveLength(3);
    expect(run.adapter.prepared).toHaveLength(4);
    expect(result.walkForward?.passedFolds).toBe(3);
    expect(result.walkForward?.medianTestObjective).toBe(1.8);
  });

  it('fails unseen folds with a missing objective even when their filters pass', async () => {
    const run = request();
    run.config.research!.robustness.enabled = false;
    run.config.objective_metric = 'sharpeRatio';
    enableWalkForward(run.config);
    const result = await runResearchValidation({ ...run, runStudy });
    expect(result.walkForward?.passedFolds).toBe(0);
    expect(result.walkForward?.folds.every((fold) => fold.testObjective === null)).toBe(true);
  });

  it('uses reserved OOS trades for Monte Carlo without restoring between stages', async () => {
    const run = request();
    enableMonteCarlo(run.config);
    const result = await runResearchValidation(run);
    const windows = result.robustness!.validationWindows;
    expect(run.adapter.evaluations.at(-1)?.range).toEqual({
      startDate: windows[0]!.startDate,
      endDate: windows.at(-1)!.endDate,
    });
    expect(result.monteCarlo).toMatchObject({ available: true, source: 'oos', sampleSize: 5 });
    expect(run.adapter.prepared).toHaveLength(1);
    expect(run.adapter.applied).toEqual([{ length: 14 }]);
  });

  it('preserves cancellation when restoring TradingView also fails', async () => {
    const run = request();
    run.config.research!.robustness.enabled = false;
    enableMonteCarlo(run.config);
    const controller = new AbortController();
    vi.spyOn(run.adapter, 'readClosedTrades').mockImplementation(async () => {
      controller.abort();
      return { available: true, reason: null, trades: [{ pnl: 10 }, { pnl: -5 }] };
    });
    run.adapter.failRestore = true;
    await expect(runResearchValidation({ ...run, signal: controller.signal })).rejects.toThrow(
      /Operation aborted.*restore failed/,
    );
  });

  it('runs every enabled stage in order within one restoration scope', async () => {
    const run = request();
    run.config.research!.stability.enabled = true;
    enableWalkForward(run.config);
    enableMonteCarlo(run.config);
    const phases: string[] = [];
    const result = await runResearchValidation({
      ...run,
      runStudy,
      onPhase: (phase) => phases.push(phase),
    });
    expect(Object.keys(result)).toEqual(['robustness', 'stability', 'walkForward', 'monteCarlo']);
    expect(phases.indexOf('Testing winner stability')).toBeLessThan(
      phases.indexOf('Walk-forward fold 1/3 · optimising'),
    );
    expect(run.adapter.prepared).toHaveLength(4);
    expect(run.adapter.applied).toHaveLength(1);
  });

  it('cancels the whole workflow before another unseen fold starts', async () => {
    const run = request();
    run.config.research!.robustness.enabled = false;
    enableWalkForward(run.config);
    const controller = new AbortController();
    const child = vi.fn(async () => {
      controller.abort();
      return progress;
    });
    await expect(
      runResearchValidation({ ...run, runStudy: child, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(child).toHaveBeenCalledTimes(1);
    expect(run.adapter.evaluations).toHaveLength(0);
    expect(run.adapter.prepared).toHaveLength(2);
    expect(run.adapter.applied).toHaveLength(1);
  });

  it('restores the parent range and parameters when a child study fails', async () => {
    const run = request();
    run.config.research!.robustness.enabled = false;
    enableWalkForward(run.config);
    await expect(
      runResearchValidation({
        ...run,
        runStudy: async () => {
          throw new Error('child failed');
        },
      }),
    ).rejects.toThrow('child failed');
    expect(run.adapter.prepared.at(-1)).toEqual({ startDate: '2020-01-01', endDate: '2022-06-30' });
    expect(run.adapter.applied).toEqual([{ length: 14 }]);
  });
});
