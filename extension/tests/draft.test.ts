import { describe, expect, it } from 'vitest';

import {
  cloneOptimisationDraft,
  DEFAULT_OPTIMISATION_DRAFT,
  normaliseOptimisationDraft,
} from '../lib/optimisation/draft';

describe('optimisation draft', () => {
  it('fills missing fields when loading an older saved draft', () => {
    const draft =
      normaliseOptimisationDraft({
        objectiveMetric: 'sharpeRatio',
        targetTrials: '250',
        maxDrawdownFilter: {
          enabled: true,
          value: '5',
        },
        dateRangeEnabled: true,
        startDate: '2020-01-01',
        endDate: '2024-01-01',
      });

    expect(draft).toMatchObject({
      objectiveMetric: 'sharpeRatio',
      targetTrials: '250',
      maxDrawdownFilter: {
        enabled: true,
        value: '5',
      },
      convergenceEnabled: false,
      robustnessValidationPercent:
        '30',
      stabilityPerturbationPercent:
        '5',
    });
  });

  it('clones nested filter state', () => {
    const clone =
      cloneOptimisationDraft(
        DEFAULT_OPTIMISATION_DRAFT,
      );

    expect(
      clone.maxDrawdownFilter,
    ).not.toBe(
      DEFAULT_OPTIMISATION_DRAFT
        .maxDrawdownFilter,
    );
    expect(clone).toEqual(
      DEFAULT_OPTIMISATION_DRAFT,
    );
  });
});
