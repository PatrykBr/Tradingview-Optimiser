import { describe, expect, it } from 'vitest';

import {
  buildWalkForwardPlan,
  summariseWalkForward,
} from '../lib/optimisation/walk-forward';
import type { SearchParameter } from '../lib/protocol/types';

describe('walk-forward research', () => {
  it('builds expanding training windows with chronological unseen tests', () => {
    const folds = buildWalkForwardPlan(
      {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2025-12-31',
      },
      3,
      0.5,
    );

    expect(folds).toHaveLength(3);

    for (let index = 0; index < folds.length; index += 1) {
      const fold = folds[index];
      if (!fold) {
        throw new Error('Missing walk-forward fold');
      }

      expect(
        Date.parse(fold.trainingRange.end_date),
      ).toBeLessThan(
        Date.parse(fold.testRange.start_date),
      );

      if (index > 0) {
        const previous = folds[index - 1];
        if (!previous) {
          throw new Error('Missing previous fold');
        }

        expect(fold.trainingRange.start_date).toBe(
          previous.trainingRange.start_date,
        );
        expect(
          Date.parse(fold.trainingRange.end_date),
        ).toBeGreaterThan(
          Date.parse(previous.trainingRange.end_date),
        );
        expect(
          Date.parse(fold.testRange.start_date),
        ).toBeGreaterThan(
          Date.parse(previous.testRange.end_date),
        );
      }
    }

    expect(folds.at(-1)?.testRange.end_date).toBe(
      '2025-12-31',
    );
  });

  it('summarises fold performance and parameter consistency', () => {
    const parameters: SearchParameter[] = [
      {
        type: 'int',
        name: 'length',
        low: 5,
        high: 25,
        step: 1,
      },
      {
        type: 'categorical',
        name: 'mode',
        choices: ['A', 'B'],
      },
    ];

    const plan = buildWalkForwardPlan(
      {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2025-12-31',
      },
      3,
      0.5,
    );

    const result = summariseWalkForward(
      plan.map((fold, index) => ({
        fold,
        runId: 'wf-' + index,
        completedTrials: 100,
        bestParameters: {
          length: 12 + index,
          mode: 'A',
        },
        inSampleObjective: 2.0,
        testObjective: [1.5, 1.8, 1.2][index] ?? null,
        passedFilters: index !== 2,
      })),
      parameters,
      'maximize',
    );

    expect(result.passedFolds).toBe(2);
    expect(result.medianTestObjective).toBe(1.5);
    expect(result.worstTestObjective).toBe(1.2);
    expect(result.parameterConsistency).toEqual({
      length: 'stable',
      mode: 'stable',
    });
  });
});
