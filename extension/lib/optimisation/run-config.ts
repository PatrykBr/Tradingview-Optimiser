import type {
  BacktestRange,
  CreateRun,
  MetricFilter,
  ResearchConfig,
} from '../protocol/types';
import type { StrategyInput } from '../tradingview/types';
import {
  cloneOptimisationDraft,
  DEFAULT_OPTIMISATION_DRAFT,
  type FilterConfig,
  type OptimisationDraft,
} from './draft';
import {
  createParameterConfigs,
  type ParameterConfig,
} from './parameter-config';
import { splitResearchRange } from './research';

export type OptimisationForm = OptimisationDraft;
export type { FilterConfig };
export const DEFAULT_OPTIMISATION_FORM =
  DEFAULT_OPTIMISATION_DRAFT;

const numberOrThrow = (
  value: string,
  label: string,
): number => {
  if (!value.trim()) {
    throw new Error(
      'Enter ' + label.toLowerCase(),
    );
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      label + ' must be a valid number',
    );
  }

  return parsed;
};

export const sameChart = (
  expected: {
    symbol: string;
    timeframe: string;
  },
  actual: {
    symbol: string;
    timeframe: string;
  },
): boolean =>
  expected.symbol === actual.symbol &&
  expected.timeframe === actual.timeframe;

export const parameterConfigsFromRun = (
  inputs: StrategyInput[],
  config: CreateRun,
): Record<string, ParameterConfig> => {
  const configs =
    createParameterConfigs(inputs);

  for (const parameter of config.parameters) {
    const current =
      configs[parameter.name];
    if (!current) continue;

    const next: ParameterConfig = {
      ...current,
      enabled: true,
      conditionParameter:
        parameter.condition?.parameter ?? '',
      conditionValues:
        parameter.condition?.values ?? [],
    };

    if (
      parameter.type === 'categorical'
    ) {
      next.choices = [
        ...parameter.choices,
      ];
    } else {
      next.low = String(parameter.low);
      next.high = String(parameter.high);
      next.step =
        parameter.type === 'int'
          ? String(parameter.step ?? 1)
          : parameter.step?.toString() ??
            '';
      next.log = parameter.log ?? false;
    }

    configs[parameter.name] = next;
  }

  return configs;
};

const filterFromRun = (
  config: CreateRun,
  metric: string,
  operator: 'lte' | 'gte',
  fallback: string,
): FilterConfig => {
  const filter = config.filters.find(
    (candidate) =>
      candidate.metric === metric &&
      candidate.operator === operator,
  );

  return filter
    ? {
        enabled: true,
        value: String(filter.value),
      }
    : {
        enabled: false,
        value: fallback,
      };
};

export const formFromRun = (
  config: CreateRun,
): OptimisationDraft => {
  const draft = cloneOptimisationDraft(
    DEFAULT_OPTIMISATION_DRAFT,
  );
  const research = config.research;
  const fullRange =
    research?.robustness.full_range ??
    config.backtest_range;

  return {
    ...draft,
    objectiveMetric:
      config.objective_metric,
    targetTrials: String(
      config.target_trials,
    ),
    maxDrawdownFilter: filterFromRun(
      config,
      'maxDrawdownPercent',
      'lte',
      draft.maxDrawdownFilter.value,
    ),
    minProfitFactorFilter: filterFromRun(
      config,
      'profitFactor',
      'gte',
      draft.minProfitFactorFilter.value,
    ),
    minTradesFilter: filterFromRun(
      config,
      'totalTrades',
      'gte',
      draft.minTradesFilter.value,
    ),
    dateRangeEnabled:
      Boolean(fullRange),
    startDate:
      fullRange?.start_date ?? '',
    endDate:
      fullRange?.end_date ?? '',
    convergenceEnabled:
      research?.convergence.enabled ??
      false,
    convergenceMinTrials: String(
      research?.convergence.min_trials ??
        draft.convergenceMinTrials,
    ),
    convergencePatience: String(
      research?.convergence.patience ??
        draft.convergencePatience,
    ),
    convergenceMinImprovementPercent:
      String(
        research?.convergence
          .min_improvement_percent ??
          draft.convergenceMinImprovementPercent,
      ),
    robustnessEnabled:
      research?.robustness.enabled ??
      false,
    robustnessValidationPercent:
      String(
        (research?.robustness
          .validation_fraction ??
          Number(
            draft.robustnessValidationPercent,
          ) /
            100) * 100,
      ),
    robustnessFolds: String(
      research?.robustness.folds ??
        draft.robustnessFolds,
    ),
    robustnessTopCandidates: String(
      research?.robustness
        .top_candidates ??
        draft.robustnessTopCandidates,
    ),
    stabilityEnabled:
      research?.stability.enabled ??
      false,
    stabilityPerturbationPercent:
      String(
        research?.stability
          .perturbation_percent ??
          draft.stabilityPerturbationPercent,
      ),
    walkForwardEnabled:
      research?.walk_forward?.enabled ??
      false,
    walkForwardFolds: String(
      research?.walk_forward?.folds ??
        draft.walkForwardFolds,
    ),
    walkForwardTrialsPerFold: String(
      research?.walk_forward
        .trials_per_fold ??
        draft.walkForwardTrialsPerFold,
    ),
    walkForwardInitialTrainingPercent:
      String(
        (research?.walk_forward
          .initial_training_fraction ??
          Number(
            draft.walkForwardInitialTrainingPercent,
          ) /
            100) * 100,
      ),
    monteCarloEnabled:
      research?.monte_carlo?.enabled ??
      false,
    monteCarloSimulations: String(
      research?.monte_carlo
        .simulations ??
        draft.monteCarloSimulations,
    ),
    monteCarloConfidencePercent: String(
      (research?.monte_carlo
        .confidence ??
        Number(
          draft.monteCarloConfidencePercent,
        ) /
          100) * 100,
    ),
  };
};

export const buildMetricFilters = (
  form: OptimisationDraft,
): MetricFilter[] => {
  const filters: MetricFilter[] = [];

  if (form.maxDrawdownFilter.enabled) {
    filters.push({
      metric: 'maxDrawdownPercent',
      operator: 'lte',
      value: numberOrThrow(
        form.maxDrawdownFilter.value,
        'Maximum drawdown filter',
      ),
    });
  }

  if (
    form.minProfitFactorFilter.enabled
  ) {
    filters.push({
      metric: 'profitFactor',
      operator: 'gte',
      value: numberOrThrow(
        form.minProfitFactorFilter.value,
        'Minimum profit factor filter',
      ),
    });
  }

  if (form.minTradesFilter.enabled) {
    filters.push({
      metric: 'totalTrades',
      operator: 'gte',
      value: numberOrThrow(
        form.minTradesFilter.value,
        'Minimum trades filter',
      ),
    });
  }

  return filters;
};

export const parseTargetTrials = (
  value: string,
): number => {
  const trials = numberOrThrow(
    value,
    'Number of trials',
  );

  if (
    !Number.isInteger(trials) ||
    trials < 1 ||
    trials > 100_000
  ) {
    throw new Error(
      'Number of trials must be an integer between 1 and 100,000',
    );
  }

  return trials;
};

export const buildBacktestRange = (
  form: OptimisationDraft,
): BacktestRange | null => {
  if (!form.dateRangeEnabled) {
    return null;
  }

  if (
    !form.startDate ||
    !form.endDate
  ) {
    throw new Error(
      'Choose both Deep Backtesting dates',
    );
  }

  if (form.startDate >= form.endDate) {
    throw new Error(
      'Backtest start date must be before the end date',
    );
  }

  return {
    mode: 'deep',
    start_date: form.startDate,
    end_date: form.endDate,
  };
};

const parseBoundedNumber = (
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = numberOrThrow(
    value,
    label,
  );

  if (
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      label +
        ' must be between ' +
        minimum +
        ' and ' +
        maximum,
    );
  }

  return parsed;
};

const parseBoundedInteger = (
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = parseBoundedNumber(
    value,
    label,
    minimum,
    maximum,
  );

  if (!Number.isInteger(parsed)) {
    throw new Error(
      label + ' must be an integer',
    );
  }

  return parsed;
};

export interface ResearchPlan {
  backtestRange: BacktestRange | null;
  research: ResearchConfig;
}

export const buildResearchPlan = (
  form: OptimisationDraft,
  targetTrials: number,
): ResearchPlan => {
  const fullRange =
    buildBacktestRange(form);

  const convergence =
    form.convergenceEnabled
      ? {
          enabled: true,
          min_trials:
            parseBoundedInteger(
              form.convergenceMinTrials,
              'Convergence minimum trials',
              5,
              targetTrials,
            ),
          patience:
            parseBoundedInteger(
              form.convergencePatience,
              'Convergence patience',
              5,
              targetTrials,
            ),
          min_improvement_percent:
            parseBoundedNumber(
              form.convergenceMinImprovementPercent,
              'Minimum convergence improvement',
              0,
              100,
            ),
        }
      : {
          enabled: false,
          min_trials: 50,
          patience: 30,
          min_improvement_percent: 1,
        };

  const validationFraction =
    form.robustnessEnabled
      ? parseBoundedNumber(
          form.robustnessValidationPercent,
          'Validation percentage',
          10,
          50,
        ) / 100
      : 0.3;

  const folds =
    form.robustnessEnabled
      ? parseBoundedInteger(
          form.robustnessFolds,
          'Validation folds',
          1,
          10,
        )
      : 3;

  const topCandidates =
    form.robustnessEnabled
      ? parseBoundedInteger(
          form.robustnessTopCandidates,
          'Top candidates',
          1,
          20,
        )
      : 5;

  const perturbationPercent =
    form.stabilityEnabled
      ? parseBoundedNumber(
          form.stabilityPerturbationPercent,
          'Stability perturbation',
          0.1,
          25,
        )
      : 5;

  const walkForwardFolds =
    form.walkForwardEnabled
      ? parseBoundedInteger(
          form.walkForwardFolds,
          'Walk-forward folds',
          2,
          8,
        )
      : 3;
  const walkForwardTrialsPerFold =
    form.walkForwardEnabled
      ? parseBoundedInteger(
          form.walkForwardTrialsPerFold,
          'Walk-forward trials per fold',
          5,
          10_000,
        )
      : 100;
  const walkForwardInitialTrainingFraction =
    form.walkForwardEnabled
      ? parseBoundedNumber(
          form.walkForwardInitialTrainingPercent,
          'Walk-forward initial training percentage',
          30,
          80,
        ) / 100
      : 0.5;
  const monteCarloSimulations =
    form.monteCarloEnabled
      ? parseBoundedInteger(
          form.monteCarloSimulations,
          'Monte Carlo simulations',
          500,
          50_000,
        )
      : 5_000;
  const monteCarloConfidence =
    form.monteCarloEnabled
      ? parseBoundedNumber(
          form.monteCarloConfidencePercent,
          'Monte Carlo confidence percentage',
          50,
          99,
        ) / 100
      : 0.9;

  if (
    (form.walkForwardEnabled ||
      form.monteCarloEnabled) &&
    !fullRange
  ) {
    throw new Error(
      'Walk-forward and Monte Carlo research require a custom Deep Backtesting date range',
    );
  }

  let optimisationRange = fullRange;

  if (form.robustnessEnabled) {
    if (!fullRange) {
      throw new Error(
        'Robustness validation requires a custom Deep Backtesting date range',
      );
    }

    optimisationRange =
      splitResearchRange(
        fullRange,
        validationFraction,
        folds,
      ).trainingRange;
  }

  return {
    backtestRange:
      optimisationRange,
    research: {
      convergence,
      robustness: {
        enabled:
          form.robustnessEnabled,
        full_range:
          form.robustnessEnabled
            ? fullRange
            : null,
        validation_fraction:
          validationFraction,
        folds,
        top_candidates:
          topCandidates,
      },
      stability: {
        enabled:
          form.stabilityEnabled,
        perturbation_percent:
          perturbationPercent,
      },
      walk_forward: {
        enabled:
          form.walkForwardEnabled,
        full_range:
          form.walkForwardEnabled
            ? fullRange
            : null,
        folds: walkForwardFolds,
        trials_per_fold:
          walkForwardTrialsPerFold,
        initial_training_fraction:
          walkForwardInitialTrainingFraction,
      },
      monte_carlo: {
        enabled:
          form.monteCarloEnabled,
        simulations:
          monteCarloSimulations,
        confidence:
          monteCarloConfidence,
      },
    },
  };
};
