import { describe, expect, it } from 'bun:test';

import {
  buildStabilityVariants,
  degradationPercent,
  rankRobustnessCandidates,
  splitResearchRange,
  stabilityRating,
  topFeasibleCandidates,
  type RobustnessCandidateResult,
} from '../lib/optimisation/research';
import type { SearchParameter, TrialSummary } from '../lib/protocol/types';

const trial = (number: number, objective: number, constraint = 0): TrialSummary => ({
  trial_number: number,
  state: 'complete',
  objective_value: objective,
  parameters: { length: 10 + number },
  metrics: {},
  constraints: { filter: constraint },
  failure_reason: null,
  duration_ms: 100,
});

describe('research utilities', () => {
  it('reserves candidate slots for distinct parameter sets, including reordered keys', () => {
    const first = { ...trial(0, 3), parameters: { length: 10, risk: 2 } };
    const reused = { ...trial(1, 3), parameters: { risk: 2, length: 10 }, reused_from_trial: 0 };
    const other = trial(2, 2);
    expect(topFeasibleCandidates([first, reused, other], 'maximize', 2)).toEqual([first, other]);
  });

  it('rejects impossible dates and single-day validation folds', () => {
    expect(() =>
      splitResearchRange(
        { mode: 'deep', start_date: '2024-02-30', end_date: '2024-12-31' },
        0.3,
        3,
      ),
    ).toThrow(/Invalid backtest date/);
    expect(() =>
      splitResearchRange(
        { mode: 'deep', start_date: '2024-01-01', end_date: '2024-01-25' },
        0.1,
        10,
      ),
    ).toThrow(/at least two days/);
  });

  it('keeps stability variants on the sampling grid below unaligned upper bounds', () => {
    const variants = buildStabilityVariants(
      [
        { type: 'int', name: 'length', low: 1, high: 10, step: 6 },
        { type: 'float', name: 'risk', low: 0.1, high: 1, step: 0.6 },
      ],
      { length: 7, risk: 0.7 },
      25,
    );
    expect(variants.map(({ parameter, value }) => [parameter, value])).toEqual([
      ['length', 1],
      ['risk', 0.1],
    ]);
    const large = buildStabilityVariants(
      [{ type: 'int', name: 'length', low: 1_000_000_000_000, high: 1_000_000_000_100, step: 1 }],
      { length: 1_000_000_000_050 },
      5,
    );
    expect(large.map(({ value }) => value)).toEqual([1_000_000_000_045, 1_000_000_000_055]);
  });

  it('splits a Deep range into training and sequential OOS folds', () => {
    const result = splitResearchRange(
      {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2024-12-31',
      },
      0.3,
      3,
    );

    expect(result.trainingRange.start_date).toBe('2020-01-01');
    expect(Date.parse(result.trainingRange.end_date)).toBeLessThan(Date.parse('2024-12-31'));
    expect(result.validationWindows).toHaveLength(3);
    expect(Date.parse(result.validationWindows[0]!.startDate)).toBeGreaterThan(
      Date.parse(result.trainingRange.end_date),
    );
    expect(result.validationWindows.at(-1)!.endDate).toBe('2024-12-31');
  });

  it('selects only feasible top candidates', () => {
    const selected = topFeasibleCandidates(
      [trial(0, 1.5), trial(1, 3.0, 1), trial(2, 2.0)],
      'maximize',
      2,
    );

    expect(selected.map((item) => item.trial_number)).toEqual([2, 0]);
  });

  it('ranks robustness by passed windows before objective', () => {
    const candidates: RobustnessCandidateResult[] = [
      {
        trialNumber: 1,
        parameters: {},
        optimisationObjective: 3,
        validationObjective: 2.5,
        passedWindows: 2,
        totalWindows: 3,
        degradationPercent: 10,
        folds: [],
      },
      {
        trialNumber: 2,
        parameters: {},
        optimisationObjective: 2,
        validationObjective: 1.8,
        passedWindows: 3,
        totalWindows: 3,
        degradationPercent: 10,
        folds: [],
      },
    ];

    expect(rankRobustnessCandidates(candidates, 'maximize')[0]!.trialNumber).toBe(2);
  });

  it('builds bounded local numeric stability variants', () => {
    const searchSpace: SearchParameter[] = [
      {
        type: 'int',
        name: 'length',
        low: 5,
        high: 25,
        step: 1,
      },
      {
        type: 'float',
        name: 'risk',
        low: 0.5,
        high: 2,
        step: 0.1,
      },
      {
        type: 'categorical',
        name: 'filter',
        choices: [true, false],
      },
    ];

    const variants = buildStabilityVariants(
      searchSpace,
      {
        length: 15,
        risk: 1,
        filter: true,
      },
      5,
    );

    expect(variants.filter((variant) => variant.parameter === 'length')).toHaveLength(2);
    expect(variants.some((variant) => variant.parameter === 'filter')).toBe(false);
  });

  it('calculates directional degradation and ratings', () => {
    expect(degradationPercent(2, 1.8, 'maximize')).toBeCloseTo(10);
    expect(degradationPercent(10, 11, 'minimize')).toBeCloseTo(10);
    expect(stabilityRating(4)).toBe('strong');
    expect(stabilityRating(10)).toBe('moderate');
    expect(stabilityRating(20)).toBe('fragile');
  });
});
