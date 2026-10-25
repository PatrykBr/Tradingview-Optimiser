import { mockGlobal } from './helpers/globals';
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type { CreateRun, RunProgress } from '../lib/protocol/types';
import {
  clearActiveRun,
  finishActiveRun,
  loadExperimentHistory,
  loadActiveRun,
  saveActiveRun,
  updateActiveRunProgress,
  updateExperimentAnalysis,
  updateExperimentResearch,
  watchExperimentHistory,
  type ExperimentRecord,
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

describe('experiment history subscriptions', () => {
  const key = 'optimisationExperimentsV1';
  const experiment = (runId: string, finishedAt: number): ExperimentRecord => ({
    version: 1,
    runId,
    config: { ...config, run_id: runId },
    startedAt: 1,
    finishedAt,
    status: 'completed',
    completedTrials: 10,
    failedTrials: 0,
    terminationReason: 'target_trials',
    best: null,
  });
  const storageFor = (initial: Promise<unknown> = Promise.resolve(undefined)) => {
    let listener: (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => void = () => {};
    const removeListener = mock();
    const get = mock(async () => ({ [key]: await initial }));
    mockGlobal('browser', {
      storage: {
        local: { get },
        onChanged: {
          addListener: mock((callback: typeof listener) => {
            listener = callback;
          }),
          removeListener,
        },
      },
    });
    return {
      get,
      removeListener,
      emit: (value: unknown, area = 'local', changedKey = key) =>
        listener({ [changedKey]: { newValue: value } }, area),
    };
  };

  it('loads, sorts and follows writes/deletion without re-reading storage', async () => {
    const first = experiment('first', 2);
    const second = experiment('second', 3);
    const storage = storageFor(Promise.resolve([first, second]));
    const changed = mock();
    const failed = mock();
    const unsubscribe = watchExperimentHistory(changed, failed);
    await Bun.sleep(0);
    expect(changed).toHaveBeenLastCalledWith([second, first]);
    storage.emit([first], 'sync');
    storage.emit([first], 'local', 'anotherKey');
    expect(changed).toHaveBeenCalledTimes(1);
    const analysed = {
      ...second,
      analysis: {
        run_id: 'second',
        parameter_importance: {},
        parameter_importance_status: 'insufficient_data' as const,
        parameter_importance_error: null,
        completed_trials: 10,
      },
    };
    storage.emit([first, analysed]);
    expect(changed).toHaveBeenLastCalledWith([analysed, first]);
    storage.emit(undefined);
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    unsubscribe();
    expect(storage.removeListener).toHaveBeenCalledTimes(1);
    storage.emit([first]);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it.each(['resolve', 'reject'] as const)(
    'keeps newer events when the initial read later %ss',
    async (outcome) => {
      const initial = Promise.withResolvers<unknown>();
      const storage = storageFor(initial.promise);
      const changed = mock();
      const failed = mock();
      const unsubscribe = watchExperimentHistory(changed, failed);
      const latest = experiment('latest', 5);
      storage.emit([latest]);
      if (outcome === 'resolve') initial.resolve([]);
      else initial.reject(new Error('stale read failed'));
      await Bun.sleep(0);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed).toHaveBeenLastCalledWith([latest]);
      expect(failed).not.toHaveBeenCalled();
      unsubscribe();
    },
  );

  it('reports corrupted initial and changed data, then accepts a valid update', async () => {
    const storage = storageFor(Promise.resolve('corrupt'));
    const changed = mock();
    const failed = mock();
    const unsubscribe = watchExperimentHistory(changed, failed);
    await Bun.sleep(0);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Experiment history is corrupted' }),
    );
    storage.emit([{}]);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
    storage.emit([]);
    expect(changed).toHaveBeenCalledWith([]);
    unsubscribe();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an initial read that %ss after unsubscribe',
    async (outcome) => {
      const initial = Promise.withResolvers<unknown>();
      storageFor(initial.promise);
      const changed = mock();
      const failed = mock();
      const unsubscribe = watchExperimentHistory(changed, failed);
      unsubscribe();
      if (outcome === 'resolve') initial.resolve([]);
      else initial.reject(new Error('read failed'));
      await Bun.sleep(0);
      expect(changed).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
    },
  );
});

const progress = (completedTrials: number): RunProgress => ({
  run_id: config.run_id,
  status: 'running',
  completed_trials: completedTrials,
  target_trials: 100,
  failed_trials: 0,
  reused_trials: 0,
  best: null,
  termination_reason: null,
  trials: Array.from({ length: completedTrials }, (_, trialNumber) => ({
    trial_number: trialNumber,
    state: 'complete' as const,
    objective_value: 1,
    parameters: {},
    metrics: { profitFactor: 1 },
    constraints: {},
    failure_reason: null,
    duration_ms: 100,
    reused_from_trial: null,
  })),
});

describe('active run checkpoints', () => {
  it('orders checkpoints, stop intent and completion without resurrecting a finished run', async () => {
    const stored: Record<string, unknown> = {};
    const pause = Promise.withResolvers<void>();
    let pauseNextRead = false;
    mockGlobal('browser', {
      storage: {
        local: {
          get: mock(async (key: string) => {
            const value = structuredClone(stored[key]);
            if (pauseNextRead) {
              pauseNextRead = false;
              await pause.promise;
            }
            return { [key]: value };
          }),
          set: mock(async (values: Record<string, unknown>) => {
            Object.assign(stored, structuredClone(values));
          }),
          remove: mock(async (key: string) => {
            delete stored[key];
          }),
        },
      },
    });
    const run = {
      version: 2 as const,
      config,
      strategyId: 'strategy-1',
      originalParameters: {},
      startedAt: 1,
      intent: 'running' as const,
      phase: 'running' as const,
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

    const analysis = {
      run_id: config.run_id,
      parameter_importance: {},
      parameter_importance_status: 'insufficient_data' as const,
      parameter_importance_error: null,
      completed_trials: 10,
    };
    await Promise.all([
      updateExperimentAnalysis(config.run_id, analysis),
      updateExperimentResearch(config.run_id, {}),
    ]);
    expect((await loadExperimentHistory())[0]).toMatchObject({ analysis, research: {} });
  });

  it('allows subsequent storage mutations after a failed write', async () => {
    const set = mock().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
    mockGlobal('browser', { storage: { local: { set } } });
    const run = {
      version: 2 as const,
      config,
      strategyId: 'strategy-1',
      originalParameters: {},
      startedAt: 1,
      intent: 'running' as const,
      phase: 'running' as const,
    };
    await expect(saveActiveRun(run)).rejects.toThrow('quota');
    await expect(saveActiveRun(run)).resolves.toBeUndefined();
  });

  afterEach(() => {
    mock.restore();
  });

  it('migrates v1 active state explicitly and rejects corrupted state', async () => {
    const stored: Record<string, unknown> = {
      activeOptimisationRun: {
        version: 1,
        config,
        strategyId: 'strategy-1',
        originalParameters: {},
        startedAt: 1_000,
      },
    };

    mockGlobal('browser', {
      storage: {
        local: {
          get: mock(async (key: string) => ({
            [key]: stored[key],
          })),
          set: mock(),
          remove: mock(),
        },
      },
    });

    await expect(loadActiveRun()).resolves.toMatchObject({
      version: 2,
      intent: 'running',
      phase: 'running',
    });

    stored.activeOptimisationRun = {
      version: 2,
      config,
      strategyId: 'strategy-1',
      originalParameters: {},
      startedAt: 1_000,
      intent: 'maybe',
      phase: 'running',
    };

    await expect(loadActiveRun()).rejects.toThrow(/unsupported version or lifecycle state/);
  });

  it('avoids storage writes for every fast trial while keeping lightweight checkpoints', async () => {
    const stored: Record<string, unknown> = {};
    const set = mock(async (values: Record<string, unknown>) => {
      Object.assign(stored, values);
    });
    const remove = mock(async (key: string) => {
      delete stored[key];
    });

    mockGlobal('browser', {
      storage: {
        local: {
          set,
          remove,
          get: mock(async (key: string) => ({
            [key]: stored[key],
          })),
        },
      },
    });

    let now = 1_000;
    spyOn(Date, 'now').mockImplementation(() => now);

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
    await updateActiveRunProgress(progress(1));
    expect(set).toHaveBeenCalledTimes(1);

    now = 1_200;
    await updateActiveRunProgress(progress(10));
    expect(set).toHaveBeenCalledTimes(2);

    const checkpoint = stored['activeOptimisationRun'] as {
      lastProgress?: RunProgress;
    };
    expect(checkpoint.lastProgress?.completed_trials).toBe(10);
    expect(checkpoint.lastProgress?.trials).toEqual([]);

    now = 6_300;
    await updateActiveRunProgress(progress(11));
    expect(set).toHaveBeenCalledTimes(3);

    await clearActiveRun();
    expect(remove).toHaveBeenCalledWith('activeOptimisationRun');
  });
});
