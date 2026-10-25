import { describe, expect, it } from 'bun:test';

import { OptimiserError } from '../lib/errors';
import {
  createStudyTrialRunner,
  type StudyTrialFailure,
} from '../lib/optimisation/study-trial-runner';
import type { NextTrial, TrialResult } from '../lib/protocol/types';

const trial = (number: number): NextTrial => ({
  run_id: 'run-1',
  trial_number: number,
  parameters: {
    length: number + 10,
  },
});

const result = (nextTrial: NextTrial): TrialResult => ({
  run_id: nextTrial.run_id,
  trial_number: nextTrial.trial_number,
  metrics: {
    profitFactor: 1.5,
  },
});

describe('study trial runner', () => {
  it('serialises trials and ignores duplicate pending notifications', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const evaluated: number[] = [];
    const submitted: number[] = [];

    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const runner = createStudyTrialRunner({
      runId: 'run-1',
      evaluate: async (nextTrial) => {
        evaluated.push(nextTrial.trial_number);

        if (nextTrial.trial_number === 0) {
          await firstGate;
        }

        return result(nextTrial);
      },
      sendRequest: async (command) => {
        if (command.type === 'TRIAL_RESULT') {
          const trialResult = command.payload;
          submitted.push(trialResult.trial_number);

          if (submitted.length === 2) {
            resolveDone?.();
          }
        }
      },
    });

    runner.enqueue(trial(0));
    runner.enqueue(trial(1));
    runner.enqueue(trial(1));

    expect(evaluated).toEqual([0]);

    releaseFirst?.();
    await done;

    expect(evaluated).toEqual([0, 1]);
    expect(submitted).toEqual([0, 1]);

    runner.dispose();
  });

  it('marks the third consecutive integration failure as fatal', async () => {
    const failures: StudyTrialFailure[] = [];
    const stopped: string[] = [];

    let resolveFailure: (() => void) | undefined;
    let failureDone = new Promise<void>((resolve) => {
      resolveFailure = resolve;
    });

    const runner = createStudyTrialRunner({
      runId: 'run-1',
      evaluate: async () => {
        throw new Error('TradingView report source missing');
      },
      sendRequest: async (command) => {
        if (command.type === 'STOP_RUN') stopped.push(command.payload.run_id);
      },
      onFailure: (failure) => {
        failures.push(failure);
        resolveFailure?.();
      },
    });

    for (let number = 0; number < 3; number += 1) {
      runner.enqueue(trial(number));
      await failureDone;

      failureDone = new Promise<void>((resolve) => {
        resolveFailure = resolve;
      });
    }

    expect(failures.map((failure) => failure.fatal)).toEqual([false, false, true]);
    expect(stopped).toEqual(['run-1']);

    runner.dispose();
  });

  it('stops immediately on a typed TradingView safety failure', async () => {
    const failures: StudyTrialFailure[] = [];
    const stopped: string[] = [];

    let resolveFailure: (() => void) | undefined;
    const failed = new Promise<void>((resolve) => {
      resolveFailure = resolve;
    });

    const runner = createStudyTrialRunner({
      runId: 'run-1',
      evaluate: async () => {
        throw new OptimiserError('TV_CONTEXT_CHANGED', 'TradingView chart changed');
      },
      sendRequest: async (command) => {
        if (command.type === 'STOP_RUN') stopped.push(command.payload.run_id);
      },
      onFailure: (failure) => {
        failures.push(failure);
        resolveFailure?.();
      },
    });

    runner.enqueue(trial(0));
    await failed;

    expect(failures[0]?.fatal).toBe(true);
    expect(stopped).toEqual(['run-1']);

    runner.dispose();
  });

  it('does not turn a backend disconnect into a failed strategy trial', async () => {
    const reportedFailures: number[] = [];

    let resolveInterrupted: (() => void) | undefined;
    const interrupted = new Promise<void>((resolve) => {
      resolveInterrupted = resolve;
    });

    const runner = createStudyTrialRunner({
      runId: 'run-1',
      evaluate: async (nextTrial) => result(nextTrial),
      sendRequest: async (command) => {
        if (command.type === 'TRIAL_RESULT') {
          throw new OptimiserError(
            'BACKEND_DISCONNECTED',
            'Backend connection closed before the request completed',
            true,
          );
        }
        if (command.type === 'TRIAL_FAILED') reportedFailures.push(command.payload.trial_number);
      },
      onTransportError: () => {
        resolveInterrupted?.();
      },
    });

    runner.enqueue(trial(0));
    await interrupted;

    expect(reportedFailures).toEqual([]);

    runner.dispose();
  });
});
