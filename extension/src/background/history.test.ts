import { describe, expect, it } from 'vitest';
import { buildWarmStartSeedTrials } from './history';
import type { TrialHistoryRun, TrialResult } from '../shared/types';

function createTrial(
  trialNumber: number,
  objectiveValue: number,
  params: Record<string, number | string | boolean>,
): TrialResult {
  return {
    trialNumber,
    params,
    metrics: [],
    objectiveValue,
    passedFilters: true,
    filterFailures: [],
    timestamp: trialNumber,
    duration: 10,
  };
}

function createRun(id: string, completedAt: number, trials: TrialResult[]): TrialHistoryRun {
  return {
    id,
    familyName: 'family',
    studyName: `study_${id}`,
    strategyName: 'strategy',
    runMode: 'fresh',
    startedAt: completedAt - 1000,
    completedAt,
    trials,
  };
}

describe('buildWarmStartSeedTrials', () => {
  it('treats typed parameter values as distinct dedup keys', () => {
    const runs: TrialHistoryRun[] = [
      createRun('run_1', 100, [
        createTrial(1, 1.1, { length: 1 }),
        createTrial(2, 2.2, { length: '1' }),
      ]),
    ];

    const seeds = buildWarmStartSeedTrials(runs, 10);

    expect(seeds).toHaveLength(2);
    expect(seeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ params: { length: 1 }, value: 1.1 }),
        expect.objectContaining({ params: { length: '1' }, value: 2.2 }),
      ]),
    );
  });

  it('caps returned seeds to the newest items', () => {
    const runs: TrialHistoryRun[] = [
      createRun('run_1', 100, [createTrial(1, 1, { p: 1 })]),
      createRun('run_2', 200, [createTrial(2, 2, { p: 2 })]),
      createRun('run_3', 300, [createTrial(3, 3, { p: 3 })]),
    ];

    const seeds = buildWarmStartSeedTrials(runs, 2);

    expect(seeds).toEqual([
      { params: { p: 2 }, value: 2 },
      { params: { p: 3 }, value: 3 },
    ]);
  });
});
