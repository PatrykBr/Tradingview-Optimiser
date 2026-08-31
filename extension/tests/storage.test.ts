import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  CreateRun,
  RunProgress,
} from '../lib/protocol/types';
import {
  clearActiveRun,
  saveActiveRun,
  updateActiveRunProgress,
} from '../lib/optimisation/storage';

const config: CreateRun = {
  run_id: 'checkpoint-run',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 100,
  parameters: [],
  filters: [],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'signature',
  },
};

const progress = (
  completedTrials: number,
): RunProgress => ({
  run_id: config.run_id,
  status: 'running',
  completed_trials: completedTrials,
  target_trials: 100,
  failed_trials: 0,
  reused_trials: 0,
  best: null,
  termination_reason: null,
  trials: Array.from(
    { length: completedTrials },
    (_, trialNumber) => ({
      trial_number: trialNumber,
      state: 'complete' as const,
      objective_value: 1,
      parameters: {},
      metrics: { profitFactor: 1 },
      constraints: {},
      failure_reason: null,
      duration_ms: 100,
      reused_from_trial: null,
    }),
  ),
});

describe('active run checkpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('avoids storage writes for every fast trial while keeping lightweight checkpoints', async () => {
    const stored: Record<string, unknown> = {};
    const set = vi.fn(
      async (
        values: Record<string, unknown>,
      ) => {
        Object.assign(stored, values);
      },
    );
    const remove = vi.fn(
      async (key: string) => {
        delete stored[key];
      },
    );

    vi.stubGlobal('browser', {
      storage: {
        local: {
          set,
          remove,
          get: vi.fn(
            async (key: string) => ({
              [key]: stored[key],
            }),
          ),
        },
      },
    });

    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(
      () => now,
    );

    await saveActiveRun({
      version: 1,
      config,
      strategyId: 'strategy-1',
      originalParameters: {},
      startedAt: now,
    });
    expect(set).toHaveBeenCalledTimes(1);

    now = 1_100;
    await updateActiveRunProgress(
      progress(1),
    );
    expect(set).toHaveBeenCalledTimes(1);

    now = 1_200;
    await updateActiveRunProgress(
      progress(10),
    );
    expect(set).toHaveBeenCalledTimes(2);

    const checkpoint = stored[
      'activeOptimisationRun'
    ] as {
      lastProgress?: RunProgress;
    };
    expect(
      checkpoint.lastProgress?.completed_trials,
    ).toBe(10);
    expect(
      checkpoint.lastProgress?.trials,
    ).toEqual([]);

    now = 6_300;
    await updateActiveRunProgress(
      progress(11),
    );
    expect(set).toHaveBeenCalledTimes(3);

    await clearActiveRun();
    expect(remove).toHaveBeenCalledWith(
      'activeOptimisationRun',
    );
  });
});
