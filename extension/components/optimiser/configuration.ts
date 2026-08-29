import type {
  BacktestRange,
  CreateRun,
  MetricFilter,
  ResearchConfig,
} from '../../lib/protocol/types';
import type { ParameterConfig } from '../../lib/optimisation/search-space';
import { defaultParameterConfig } from '../../lib/optimisation/search-space';
import type { SavedOptimisationPreset } from '../../lib/optimisation/presets';
import { splitResearchRange } from '../../lib/optimisation/research';
import type { StrategyInput } from '../../lib/tradingview/types';

export interface FilterConfig {
  enabled: boolean;
  value: string;
}

export interface OptimisationForm {
  objectiveMetric: string;
  targetTrials: string;
  maxDrawdownFilter: FilterConfig;
  minProfitFactorFilter: FilterConfig;
  minTradesFilter: FilterConfig;
  dateRangeEnabled: boolean;
  startDate: string;
  endDate: string;
  convergenceEnabled: boolean;
  convergenceMinTrials: string;
  convergencePatience: string;
  convergenceMinImprovementPercent: string;
  robustnessEnabled: boolean;
  robustnessValidationPercent: string;
  robustnessFolds: string;
  robustnessTopCandidates: string;
  stabilityEnabled: boolean;
  stabilityPerturbationPercent: string;
}

export const DEFAULT_OPTIMISATION_FORM: OptimisationForm = {
  objectiveMetric: 'profitFactor',
  targetTrials: '100',
  maxDrawdownFilter: { enabled: false, value: '8' },
  minProfitFactorFilter: { enabled: false, value: '1.3' },
  minTradesFilter: { enabled: false, value: '100' },
  dateRangeEnabled: false,
  startDate: '',
  endDate: '',
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
};

const numberOrThrow = (
  value: string,
  label: string,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(label + ' must be a valid number');
  }
  return parsed;
};

export const sameChart = (
  expected: { symbol: string; timeframe: string },
  actual: { symbol: string; timeframe: string },
): boolean =>
  expected.symbol === actual.symbol &&
  expected.timeframe === actual.timeframe;

export const parameterConfigsFromRun = (
  inputs: StrategyInput[],
  config: CreateRun,
): Record<string, ParameterConfig> => {
  const configs = Object.fromEntries(
    inputs.map((input) => [
      input.id,
      defaultParameterConfig(input),
    ]),
  ) as Record<string, ParameterConfig>;

  for (const parameter of config.parameters) {
    const current = configs[parameter.name];
    if (!current) continue;

    const next: ParameterConfig = {
      ...current,
      enabled: true,
      conditionParameter: parameter.condition?.parameter ?? '',
      conditionValues: parameter.condition?.values ?? [],
    };

    if (parameter.type === 'categorical') {
      next.choices = [...parameter.choices];
    } else {
      next.low = String(parameter.low);
      next.high = String(parameter.high);
      next.step =
        parameter.type === 'int'
          ? String(parameter.step ?? 1)
          : parameter.step?.toString() ?? '';
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
    ? { enabled: true, value: String(filter.value) }
    : { enabled: false, value: fallback };
};

export const formFromRun = (
  config: CreateRun,
): OptimisationForm => {
  const research = config.research;
  const fullRange =
    research?.robustness.full_range ??
    config.backtest_range;

  return {
    objectiveMetric: config.objective_metric,
    targetTrials: String(config.target_trials),
    maxDrawdownFilter: filterFromRun(
      config,
      'maxDrawdownPercent',
      'lte',
      '8',
    ),
    minProfitFactorFilter: filterFromRun(
      config,
      'profitFactor',
      'gte',
      '1.3',
    ),
    minTradesFilter: filterFromRun(
      config,
      'totalTrades',
      'gte',
      '100',
    ),
    dateRangeEnabled: Boolean(fullRange),
    startDate: fullRange?.start_date ?? '',
    endDate: fullRange?.end_date ?? '',
    convergenceEnabled:
      research?.convergence.enabled ?? false,
    convergenceMinTrials: String(
      research?.convergence.min_trials ?? 50,
    ),
    convergencePatience: String(
      research?.convergence.patience ?? 30,
    ),
    convergenceMinImprovementPercent: String(
      research?.convergence
        .min_improvement_percent ?? 1,
    ),
    robustnessEnabled:
      research?.robustness.enabled ?? false,
    robustnessValidationPercent: String(
      (research?.robustness
        .validation_fraction ?? 0.3) * 100,
    ),
    robustnessFolds: String(
      research?.robustness.folds ?? 3,
    ),
    robustnessTopCandidates: String(
      research?.robustness.top_candidates ?? 5,
    ),
    stabilityEnabled:
      research?.stability.enabled ?? false,
    stabilityPerturbationPercent: String(
      research?.stability
        .perturbation_percent ?? 5,
    ),
  };
};

export const formFromPreset = (
  preset: SavedOptimisationPreset,
): OptimisationForm => ({
  objectiveMetric: preset.objectiveMetric,
  targetTrials: preset.targetTrials,
  maxDrawdownFilter: {
    ...preset.maxDrawdownFilter,
  },
  minProfitFactorFilter: {
    ...preset.minProfitFactorFilter,
  },
  minTradesFilter: {
    ...preset.minTradesFilter,
  },
  dateRangeEnabled: preset.dateRangeEnabled,
  startDate: preset.startDate,
  endDate: preset.endDate,
  convergenceEnabled:
    preset.convergenceEnabled ?? false,
  convergenceMinTrials:
    preset.convergenceMinTrials ?? '50',
  convergencePatience:
    preset.convergencePatience ?? '30',
  convergenceMinImprovementPercent:
    preset.convergenceMinImprovementPercent ?? '1',
  robustnessEnabled:
    preset.robustnessEnabled ?? false,
  robustnessValidationPercent:
    preset.robustnessValidationPercent ?? '30',
  robustnessFolds:
    preset.robustnessFolds ?? '3',
  robustnessTopCandidates:
    preset.robustnessTopCandidates ?? '5',
  stabilityEnabled:
    preset.stabilityEnabled ?? false,
  stabilityPerturbationPercent:
    preset.stabilityPerturbationPercent ?? '5',
});

export const buildMetricFilters = (
  form: OptimisationForm,
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

  if (form.minProfitFactorFilter.enabled) {
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

export const parseTargetTrials = (value: string): number => {
  const trials = numberOrThrow(value, 'Number of trials');

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
  form: OptimisationForm,
): BacktestRange | null => {
  if (!form.dateRangeEnabled) return null;

  if (!form.startDate || !form.endDate) {
    throw new Error('Choose both Deep Backtesting dates');
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
  const parsed = numberOrThrow(value, label);
  if (parsed < minimum || parsed > maximum) {
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
    throw new Error(label + ' must be an integer');
  }
  return parsed;
};

export interface ResearchPlan {
  backtestRange: BacktestRange | null;
  research: ResearchConfig;
}

export const buildResearchPlan = (
  form: OptimisationForm,
  targetTrials: number,
): ResearchPlan => {
  const fullRange = buildBacktestRange(form);

  const convergence = form.convergenceEnabled
    ? {
        enabled: true,
        min_trials: parseBoundedInteger(
          form.convergenceMinTrials,
          'Convergence minimum trials',
          5,
          targetTrials,
        ),
        patience: parseBoundedInteger(
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
  const folds = form.robustnessEnabled
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

  let optimisationRange = fullRange;
  if (form.robustnessEnabled) {
    if (!fullRange) {
      throw new Error(
        'Robustness validation requires a custom Deep Backtesting date range',
      );
    }

    optimisationRange = splitResearchRange(
      fullRange,
      validationFraction,
      folds,
    ).trainingRange;
  }

  return {
    backtestRange: optimisationRange,
    research: {
      convergence,
      robustness: {
        enabled: form.robustnessEnabled,
        full_range: form.robustnessEnabled
          ? fullRange
          : null,
        validation_fraction:
          validationFraction,
        folds,
        top_candidates: topCandidates,
      },
      stability: {
        enabled: form.stabilityEnabled,
        perturbation_percent:
          perturbationPercent,
      },
    },
  };
};
