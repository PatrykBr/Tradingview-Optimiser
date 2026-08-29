export interface FilterConfig {
  enabled: boolean;
  value: string;
}

export interface OptimisationDraft {
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
  walkForwardEnabled: boolean;
  walkForwardFolds: string;
  walkForwardTrialsPerFold: string;
  walkForwardInitialTrainingPercent: string;
  monteCarloEnabled: boolean;
  monteCarloSimulations: string;
  monteCarloConfidencePercent: string;
}

export const DEFAULT_OPTIMISATION_DRAFT: OptimisationDraft = {
  objectiveMetric: 'profitFactor',
  targetTrials: '100',
  maxDrawdownFilter: {
    enabled: false,
    value: '8',
  },
  minProfitFactorFilter: {
    enabled: false,
    value: '1.3',
  },
  minTradesFilter: {
    enabled: false,
    value: '100',
  },
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
  walkForwardEnabled: false,
  walkForwardFolds: '3',
  walkForwardTrialsPerFold: '100',
  walkForwardInitialTrainingPercent: '50',
  monteCarloEnabled: false,
  monteCarloSimulations: '5000',
  monteCarloConfidencePercent: '90',
};

export const cloneOptimisationDraft = (
  draft: OptimisationDraft,
): OptimisationDraft => ({
  ...draft,
  maxDrawdownFilter: {
    ...draft.maxDrawdownFilter,
  },
  minProfitFactorFilter: {
    ...draft.minProfitFactorFilter,
  },
  minTradesFilter: {
    ...draft.minTradesFilter,
  },
});


const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value);

const stringField = (
  record: Record<string, unknown>,
  key: keyof OptimisationDraft,
  fallback: string,
): string => {
  const value = record[key];
  return typeof value === 'string'
    ? value
    : fallback;
};

const booleanField = (
  record: Record<string, unknown>,
  key: keyof OptimisationDraft,
  fallback: boolean,
): boolean => {
  const value = record[key];
  return typeof value === 'boolean'
    ? value
    : fallback;
};

const filterField = (
  record: Record<string, unknown>,
  key:
    | 'maxDrawdownFilter'
    | 'minProfitFactorFilter'
    | 'minTradesFilter',
  fallback: FilterConfig,
): FilterConfig => {
  const value = record[key];
  if (!isRecord(value)) {
    return { ...fallback };
  }

  return {
    enabled:
      typeof value.enabled === 'boolean'
        ? value.enabled
        : fallback.enabled,
    value:
      typeof value.value === 'string'
        ? value.value
        : fallback.value,
  };
};

export const normaliseOptimisationDraft = (
  value: unknown,
): OptimisationDraft => {
  const defaults = cloneOptimisationDraft(
    DEFAULT_OPTIMISATION_DRAFT,
  );

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    objectiveMetric: stringField(
      value,
      'objectiveMetric',
      defaults.objectiveMetric,
    ),
    targetTrials: stringField(
      value,
      'targetTrials',
      defaults.targetTrials,
    ),
    maxDrawdownFilter: filterField(
      value,
      'maxDrawdownFilter',
      defaults.maxDrawdownFilter,
    ),
    minProfitFactorFilter: filterField(
      value,
      'minProfitFactorFilter',
      defaults.minProfitFactorFilter,
    ),
    minTradesFilter: filterField(
      value,
      'minTradesFilter',
      defaults.minTradesFilter,
    ),
    dateRangeEnabled: booleanField(
      value,
      'dateRangeEnabled',
      defaults.dateRangeEnabled,
    ),
    startDate: stringField(
      value,
      'startDate',
      defaults.startDate,
    ),
    endDate: stringField(
      value,
      'endDate',
      defaults.endDate,
    ),
    convergenceEnabled: booleanField(
      value,
      'convergenceEnabled',
      defaults.convergenceEnabled,
    ),
    convergenceMinTrials: stringField(
      value,
      'convergenceMinTrials',
      defaults.convergenceMinTrials,
    ),
    convergencePatience: stringField(
      value,
      'convergencePatience',
      defaults.convergencePatience,
    ),
    convergenceMinImprovementPercent:
      stringField(
        value,
        'convergenceMinImprovementPercent',
        defaults.convergenceMinImprovementPercent,
      ),
    robustnessEnabled: booleanField(
      value,
      'robustnessEnabled',
      defaults.robustnessEnabled,
    ),
    robustnessValidationPercent:
      stringField(
        value,
        'robustnessValidationPercent',
        defaults.robustnessValidationPercent,
      ),
    robustnessFolds: stringField(
      value,
      'robustnessFolds',
      defaults.robustnessFolds,
    ),
    robustnessTopCandidates: stringField(
      value,
      'robustnessTopCandidates',
      defaults.robustnessTopCandidates,
    ),
    stabilityEnabled: booleanField(
      value,
      'stabilityEnabled',
      defaults.stabilityEnabled,
    ),
    stabilityPerturbationPercent:
      stringField(
        value,
        'stabilityPerturbationPercent',
        defaults.stabilityPerturbationPercent,
      ),
    walkForwardEnabled: booleanField(
      value,
      'walkForwardEnabled',
      defaults.walkForwardEnabled,
    ),
    walkForwardFolds: stringField(
      value,
      'walkForwardFolds',
      defaults.walkForwardFolds,
    ),
    walkForwardTrialsPerFold:
      stringField(
        value,
        'walkForwardTrialsPerFold',
        defaults.walkForwardTrialsPerFold,
      ),
    walkForwardInitialTrainingPercent:
      stringField(
        value,
        'walkForwardInitialTrainingPercent',
        defaults.walkForwardInitialTrainingPercent,
      ),
    monteCarloEnabled: booleanField(
      value,
      'monteCarloEnabled',
      defaults.monteCarloEnabled,
    ),
    monteCarloSimulations: stringField(
      value,
      'monteCarloSimulations',
      defaults.monteCarloSimulations,
    ),
    monteCarloConfidencePercent:
      stringField(
        value,
        'monteCarloConfidencePercent',
        defaults.monteCarloConfidencePercent,
      ),
  };
};
