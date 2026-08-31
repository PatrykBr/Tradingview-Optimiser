import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  mergeRunUpdate,
} from '../lib/optimisation/run-progress';
import type {
  RunProgress,
  RunUpdate,
} from '../lib/protocol/types';

const progress: RunProgress = {
  run_id: 'run-1',
  status: 'running',
  completed_trials: 1,
  target_trials: 3,
  failed_trials: 0,
  reused_trials: 0,
  best: {
    trial_number: 0,
    objective_value: 1.5,
    parameters: { length: 10 },
    metrics: { profitFactor: 1.5 },
    constraints: {},
  },
  termination_reason: null,
  trials: [
    {
      trial_number: 0,
      state: 'complete',
      objective_value: 1.5,
      parameters: { length: 10 },
      metrics: { profitFactor: 1.5 },
      constraints: {},
      failure_reason: null,
      duration_ms: 1000,
      reused_from_trial: null,
    },
  ],
};

describe('incremental run progress', () => {
  it('merges trial deltas without duplicating existing history', () => {
    const update: RunUpdate = {
      run_id: 'run-1',
      status: 'running',
      completed_trials: 2,
      target_trials: 3,
      failed_trials: 0,
      reused_trials: 0,
      best: {
        trial_number: 1,
        objective_value: 1.8,
        parameters: { length: 12 },
        metrics: { profitFactor: 1.8 },
        constraints: {},
      },
      termination_reason: null,
      trial_updates: [
        {
          trial_number: 1,
          state: 'complete',
          objective_value: 1.8,
          parameters: { length: 12 },
          metrics: { profitFactor: 1.8 },
          constraints: {},
          failure_reason: null,
          duration_ms: 900,
          reused_from_trial: null,
        },
      ],
    };

    const merged =
      mergeRunUpdate(
        progress,
        update,
      );

    expect(
      merged.trials.map(
        (trial) =>
          trial.trial_number,
      ),
    ).toEqual([0, 1]);
    expect(merged.best?.trial_number).toBe(1);

    const repeated =
      mergeRunUpdate(
        merged,
        update,
      );

    expect(
      repeated.trials,
    ).toHaveLength(2);
  });

  it('can recover a usable snapshot from an update alone', () => {
    const update: RunUpdate = {
      run_id: 'run-2',
      status: 'completed',
      completed_trials: 1,
      target_trials: 1,
      failed_trials: 0,
      best: null,
      termination_reason:
        'target_trials',
      trial_updates: [],
    };

    expect(
      mergeRunUpdate(
        null,
        update,
      ),
    ).toMatchObject({
      run_id: 'run-2',
      status: 'completed',
      completed_trials: 1,
      trials: [],
    });
  });
});
