import type {
  BacktestRange,
  CreateRun,
  MetricFilter,
} from '../../lib/protocol/types';
import type { ParameterConfig } from '../../lib/optimisation/search-space';
import { defaultParameterConfig } from '../../lib/optimisation/search-space';
import type { SavedOptimisationPreset } from '../../lib/optimisation/presets';
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
): OptimisationForm => ({
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
  dateRangeEnabled: Boolean(config.backtest_range),
  startDate: config.backtest_range?.start_date ?? '',
  endDate: config.backtest_range?.end_date ?? '',
});

export const formFromPreset = (
  preset: SavedOptimisationPreset,
): OptimisationForm => ({
  objectiveMetric: preset.objectiveMetric,
  targetTrials: preset.targetTrials,
  maxDrawdownFilter: { ...preset.maxDrawdownFilter },
  minProfitFactorFilter: { ...preset.minProfitFactorFilter },
  minTradesFilter: { ...preset.minTradesFilter },
  dateRangeEnabled: preset.dateRangeEnabled,
  startDate: preset.startDate,
  endDate: preset.endDate,
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
