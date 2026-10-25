import { describe, expect, it } from 'bun:test';

import { buildResearchVerdict } from '../lib/optimisation/research-verdict';
import type { RunProgress } from '../lib/protocol/types';

const progress: RunProgress = {
  run_id: 'run-1',
  status: 'completed',
  completed_trials: 100,
  target_trials: 100,
  failed_trials: 0,
  best: {
    trial_number: 10,
    objective_value: 2,
    parameters: {},
    metrics: {
      totalTrades: 420,
    },
    constraints: {},
  },
  trials: [],
};

describe('research verdict', () => {
  it('rates strong evidence and lists its contributing areas', () => {
    const verdict = buildResearchVerdict(progress, {
      robustness: {
        trainingRange: {
          mode: 'deep',
          start_date: '2020-01-01',
          end_date: '2023-12-31',
        },
        validationWindows: [],
        winnerTrialNumber: 10,
        winnerParameters: {},
        candidates: [
          {
            trialNumber: 10,
            parameters: {},
            optimisationObjective: 2,
            validationObjective: 1.8,
            passedWindows: 3,
            totalWindows: 3,
            degradationPercent: 10,
            folds: [],
          },
        ],
      },
      stability: {
        baselineObjective: 1.8,
        range: null,
        overallRating: 'strong',
        parameters: [],
      },
    });

    expect(verdict.overall).toBe('strong');
    expect(verdict.areas.map((area) => area.id)).toEqual(['sample', 'robustness', 'stability']);
    expect(verdict.concerns).toEqual([]);
  });

  it('lists weak and unavailable evidence as concerns', () => {
    const verdict = buildResearchVerdict(
      {
        ...progress,
        best: progress.best
          ? {
              ...progress.best,
              metrics: {
                totalTrades: 40,
              },
            }
          : null,
      },
      {
        monteCarlo: {
          available: false,
          source: 'optimisation',
          range: null,
          reason: 'No closed trades',
          sampleSize: 0,
          simulations: 5_000,
          confidence: 0.9,
          unit: 'pnl',
          probabilityOfLoss: null,
          total: null,
          maxDrawdown: null,
          profitFactor: null,
        },
      },
    );

    expect(verdict.overall).toBe('moderate');
    expect(verdict.concerns).toHaveLength(2);
    expect(verdict.concerns.join(' ')).toMatch(/small sample|No closed trades/i);
  });
});
