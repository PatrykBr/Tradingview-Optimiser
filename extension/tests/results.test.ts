import { describe, expect, it } from 'bun:test';

import {
  bestSoFar,
  estimateRemainingMs,
  extendBestSoFar,
  filterTrials,
  sortTrials,
} from '../lib/optimisation/results';
import type { TrialSummary } from '../lib/protocol/types';

const trial = (
  trial_number: number,
  objective_value: number | null,
  constraints: Record<string, number> = {},
  state: 'complete' | 'failed' = 'complete',
  duration_ms = 1000,
): TrialSummary => ({
  trial_number,
  state,
  objective_value,
  parameters: {},
  metrics: {},
  constraints,
  failure_reason: state === 'failed' ? 'failed' : null,
  duration_ms,
});

describe('result utilities', () => {
  const trials = [
    trial(0, 1.2),
    trial(1, 2.1, { drawdown: 1 }),
    trial(2, 1.8),
    trial(3, null, {}, 'failed'),
  ];

  it('filters valid, constrained and failed trials', () => {
    expect(filterTrials(trials, 'valid').map((item) => item.trial_number)).toEqual([0, 2]);
    expect(filterTrials(trials, 'filtered').map((item) => item.trial_number)).toEqual([1]);
    expect(filterTrials(trials, 'failed').map((item) => item.trial_number)).toEqual([3]);
  });

  it('sorts objectives in the study direction', () => {
    expect(
      sortTrials(trials, 'objective-best', 'maximize').map((item) => item.trial_number),
    ).toEqual([1, 2, 0, 3]);

    expect(
      sortTrials(trials, 'objective-best', 'minimize').map((item) => item.trial_number),
    ).toEqual([0, 2, 1, 3]);
  });

  it('tracks best feasible value over time', () => {
    expect(bestSoFar(trials, 'maximize')).toEqual([
      { trial: 0, value: 1.2 },
      { trial: 2, value: 1.8 },
    ]);
  });

  it('extends best-so-far history without recomputing prior trials', () => {
    const initial = bestSoFar(trials.slice(0, 2), 'maximize');
    const extended = extendBestSoFar(initial, trials.slice(2), 'maximize');

    expect(extended).toEqual(bestSoFar(trials, 'maximize'));
  });

  it('estimates remaining time from recent durations', () => {
    expect(
      estimateRemainingMs(
        [trial(0, 1, {}, 'complete', 1000), trial(1, 2, {}, 'complete', 3000)],
        2,
        5,
      ),
    ).toBe(6000);
  });
});
