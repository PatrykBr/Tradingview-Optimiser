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
  finishActiveRun,
  loadExperimentHistory,
  loadActiveRun,
  saveActiveRun,
  updateActiveRunProgress,
  updateExperimentAnalysis,
  updateExperimentResearch,
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
  it('orders checkpoints, stop intent and completion without resurrecting a finished run', async () => {
    const stored: Record<string, unknown> = {};
    const pause = Promise.withResolvers<void>();
    let pauseNextRead = false;
    vi.stubGlobal('browser', { storage: { local: {
      get: vi.fn(async (key: string) => {
        const value = structuredClone(stored[key]);
        if (pauseNextRead) {
          pauseNextRead = false;
          await pause.promise;
        }
        return { [key]: value };
      }),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } } });
    const run = {
      version: 2 as const, config, strategyId: 'strategy-1', originalParameters: {},
      startedAt: 1, intent: 'running' as const, phase: 'running' as const,
    };
    await saveActiveRun(run);
    pauseNextRead = true;
    const checkpoint = updateActiveRunProgress(progress(10));
    const stop = saveActiveRun({ ...run, intent: 'stopped', phase: 'stopping' });
    const finish = finishActiveRun({ ...progress(10), status: 'stopped' });
    // Let other storage work finish while the earlier checkpoint read is stalled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    pause.resolve();
    await Promise.all([checkpoint, stop, finish]);
    expect(await loadActiveRun()).toBeNull();
    expect(stored.lastOptimisationRun).toMatchObject({ intent: 'stopped', phase: 'stopping' });

    const analysis = { run_id: config.run_id, parameter_importance: {}, parameter_importance_status: 'insufficient_data' as const, parameter_importance_error: null, completed_trials: 10 };
    await Promise.all([
      updateExperimentAnalysis(config.run_id, analysis),
      updateExperimentResearch(config.run_id, {}),
    ]);
    expect((await loadExperimentHistory())[0]).toMatchObject({ analysis, research: {} });
  });

  it('allows subsequent storage mutations after a failed write', async () => {
    const set = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
    vi.stubGlobal('browser', { storage: { local: { set } } });
    const run = { version: 2 as const, config, strategyId: 'strategy-1', originalParameters: {}, startedAt: 1, intent: 'running' as const, phase: 'running' as const };
    await expect(saveActiveRun(run)).rejects.toThrow('quota');
    await expect(saveActiveRun(run)).resolves.toBeUndefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('migrates v1 active state explicitly and rejects corrupted state', async () => {
    const stored:
      Record<string, unknown> = {
      activeOptimisationRun: {
        version: 1,
        config,
        strategyId:
          'strategy-1',
        originalParameters: {},
        startedAt: 1_000,
      },
    };

    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(
            async (key: string) => ({
              [key]: stored[key],
            }),
          ),
          set: vi.fn(),
          remove: vi.fn(),
        },
      },
    });

    await expect(
      loadActiveRun(),
    ).resolves.toMatchObject({
      version: 2,
      intent: 'running',
      phase: 'running',
    });

    stored.activeOptimisationRun = {
      version: 2,
      config,
      strategyId:
        'strategy-1',
      originalParameters: {},
      startedAt: 1_000,
      intent: 'maybe',
      phase: 'running',
    };

    await expect(
      loadActiveRun(),
    ).rejects.toThrow(
      /unsupported version or lifecycle state/,
    );
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
      version: 2,
      config,
      strategyId: 'strategy-1',
      originalParameters: {},
      startedAt: now,
      intent: 'running',
      phase: 'running',
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
