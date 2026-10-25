import { describe, expect, it } from 'bun:test';

import {
  buildBacktestRange,
  buildMetricFilters,
  buildResearchPlan,
  formFromRun,
  parameterConfigsFromRun,
  parseTargetTrials,
} from '../lib/optimisation/run-config';
import { DEFAULT_OPTIMISATION_DRAFT } from '../lib/optimisation/draft';
import type { CreateRun } from '../lib/protocol/types';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'in_0',
    label: 'Length',
    type: 'integer',
    currentValue: 14,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    id: 'in_1',
    label: 'Filter',
    type: 'boolean',
    currentValue: true,
  },
];

const run: CreateRun = {
  run_id: 'run-1',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 250,
  parameters: [
    {
      type: 'int',
      name: 'in_0',
      low: 5,
      high: 30,
      step: 1,
      log: false,
    },
    {
      type: 'categorical',
      name: 'in_1',
      choices: [false, true],
    },
  ],
  filters: [
    {
      metric: 'maxDrawdownPercent',
      operator: 'lte',
      value: 8,
    },
    {
      metric: 'totalTrades',
      operator: 'gte',
      value: 100,
    },
  ],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'signature',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2024-01-01',
    end_date: '2025-01-01',
  },
};

describe('optimisation configuration', () => {
  it('restores the full form from a persisted run', () => {
    expect(formFromRun(run)).toEqual({
      objectiveMetric: 'profitFactor',
      targetTrials: '250',
      maxDrawdownFilter: {
        enabled: true,
        value: '8',
      },
      minProfitFactorFilter: {
        enabled: false,
        value: '1.3',
      },
      minTradesFilter: {
        enabled: true,
        value: '100',
      },
      dateRangeEnabled: true,
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      convergenceEnabled: false,
      convergenceMinTrials: '50',
      convergencePatience: '30',
      convergenceMinImprovementPercent: '1',
      robustnessEnabled: false,
      robustnessValidationPercent: '30',
      robustnessFolds: '3',
      robustnessTopCandidates: '5',
      stabilityEnabled: false,
      stabilityPerturbationPercent: '5',
      walkForwardEnabled: false,
      walkForwardFolds: '3',
      walkForwardTrialsPerFold: '100',
      walkForwardInitialTrainingPercent: '50',
      monteCarloEnabled: false,
      monteCarloSimulations: '5000',
      monteCarloConfidencePercent: '90',
    });
  });

  it('restores parameter search-space settings from a run', () => {
    const configs = parameterConfigsFromRun(inputs, run);

    expect(configs.in_0).toMatchObject({
      enabled: true,
      low: '5',
      high: '30',
      step: '1',
      log: false,
    });
    expect(configs.in_1).toMatchObject({
      enabled: true,
      choices: [false, true],
    });
  });

  it('builds filters and Deep Backtesting range from the form', () => {
    const form = formFromRun(run);

    expect(buildMetricFilters(form)).toEqual(run.filters);
    expect(buildBacktestRange(form)).toEqual(run.backtest_range ?? null);
  });

  it('validates trial counts and date ranges', () => {
    expect(parseTargetTrials('1000')).toBe(1000);
    expect(() => parseTargetTrials('0')).toThrow(/between 1 and 100,000/);
    expect(() =>
      buildBacktestRange({
        ...DEFAULT_OPTIMISATION_DRAFT,
        dateRangeEnabled: true,
        startDate: '2025-01-01',
        endDate: '2024-01-01',
      }),
    ).toThrow(/start date must be before/);
  });

  it('rejects blank values for enabled metric filters', () => {
    expect(() =>
      buildMetricFilters({
        ...DEFAULT_OPTIMISATION_DRAFT,
        maxDrawdownFilter: {
          enabled: true,
          value: '',
        },
      }),
    ).toThrow(/enter maximum drawdown filter/i);
  });

  it('keeps disabled research inert for small runs', () => {
    expect(() => buildResearchPlan(DEFAULT_OPTIMISATION_DRAFT, 5)).not.toThrow();

    const plan = buildResearchPlan(DEFAULT_OPTIMISATION_DRAFT, 5);
    expect(plan.research.convergence.enabled).toBe(false);
    expect(plan.research.robustness.enabled).toBe(false);
    expect(plan.research.stability.enabled).toBe(false);
    expect(plan.research.walk_forward?.enabled).toBe(false);
    expect(plan.research.monte_carlo?.enabled).toBe(false);
  });

  it('persists full date range for advanced research modes', () => {
    const plan = buildResearchPlan(
      {
        ...DEFAULT_OPTIMISATION_DRAFT,
        dateRangeEnabled: true,
        startDate: '2020-01-01',
        endDate: '2025-12-31',
        walkForwardEnabled: true,
        walkForwardFolds: '4',
        walkForwardTrialsPerFold: '150',
        walkForwardInitialTrainingPercent: '55',
        monteCarloEnabled: true,
        monteCarloSimulations: '7000',
        monteCarloConfidencePercent: '95',
      },
      500,
    );

    expect(plan.research.walk_forward).toEqual({
      enabled: true,
      full_range: {
        mode: 'deep',
        start_date: '2020-01-01',
        end_date: '2025-12-31',
      },
      folds: 4,
      trials_per_fold: 150,
      initial_training_fraction: 0.55,
    });
    expect(plan.research.monte_carlo).toEqual({
      enabled: true,
      simulations: 7000,
      confidence: 0.95,
    });
  });

  it('reserves OOS data when robustness is enabled', () => {
    const plan = buildResearchPlan(
      {
        ...DEFAULT_OPTIMISATION_DRAFT,
        dateRangeEnabled: true,
        startDate: '2020-01-01',
        endDate: '2024-12-31',
        robustnessEnabled: true,
      },
      100,
    );

    expect(plan.research.robustness.enabled).toBe(true);
    expect(plan.research.robustness.full_range).toEqual({
      mode: 'deep',
      start_date: '2020-01-01',
      end_date: '2024-12-31',
    });
    expect(plan.backtestRange?.end_date).not.toBe('2024-12-31');
  });
});
