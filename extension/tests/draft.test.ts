import { describe, expect, it } from 'bun:test';

import {
  cloneOptimisationDraft,
  DEFAULT_OPTIMISATION_DRAFT,
  isOptimisationDraft,
  normaliseOptimisationDraft,
} from '../lib/optimisation/draft';

describe('optimisation draft', () => {
  it('fills missing fields when loading an older saved draft', () => {
    const draft = normaliseOptimisationDraft({
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
      robustnessValidationPercent: '30',
      stabilityPerturbationPercent: '5',
      walkForwardEnabled: false,
      walkForwardFolds: '3',
      walkForwardTrialsPerFold: '100',
      monteCarloEnabled: false,
      monteCarloSimulations: '5000',
      monteCarloConfidencePercent: '90',
    });
  });

  it('distinguishes a complete current draft from a malformed one', () => {
    expect(isOptimisationDraft(DEFAULT_OPTIMISATION_DRAFT)).toBe(true);

    expect(
      isOptimisationDraft({
        ...DEFAULT_OPTIMISATION_DRAFT,
        targetTrials: 100,
      }),
    ).toBe(false);
  });

  it('clones nested filter state', () => {
    const clone = cloneOptimisationDraft(DEFAULT_OPTIMISATION_DRAFT);

    expect(clone.maxDrawdownFilter).not.toBe(DEFAULT_OPTIMISATION_DRAFT.maxDrawdownFilter);
    expect(clone).toEqual(DEFAULT_OPTIMISATION_DRAFT);
  });
});
