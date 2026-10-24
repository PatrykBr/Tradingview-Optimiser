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

const isFilterConfig = (
  value: unknown,
): value is FilterConfig => {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('enabled') &&
    keys.includes('value') &&
    typeof value.enabled === 'boolean' &&
    typeof value.value === 'string'
  );
};

const STRING_DRAFT_FIELDS = [
  'objectiveMetric',
  'targetTrials',
  'startDate',
  'endDate',
  'convergenceMinTrials',
  'convergencePatience',
  'convergenceMinImprovementPercent',
  'robustnessValidationPercent',
  'robustnessFolds',
  'robustnessTopCandidates',
  'stabilityPerturbationPercent',
  'walkForwardFolds',
  'walkForwardTrialsPerFold',
  'walkForwardInitialTrainingPercent',
  'monteCarloSimulations',
  'monteCarloConfidencePercent',
] as const;

const BOOLEAN_DRAFT_FIELDS = [
  'dateRangeEnabled',
  'convergenceEnabled',
  'robustnessEnabled',
  'stabilityEnabled',
  'walkForwardEnabled',
  'monteCarloEnabled',
] as const;

const FILTER_DRAFT_FIELDS = [
  'maxDrawdownFilter',
  'minProfitFactorFilter',
  'minTradesFilter',
] as const;

const DRAFT_FIELDS = new Set<string>([
  ...STRING_DRAFT_FIELDS,
  ...BOOLEAN_DRAFT_FIELDS,
  ...FILTER_DRAFT_FIELDS,
]);

export const isOptimisationDraft = (
  value: unknown,
): value is OptimisationDraft => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    Object.keys(value).some(
      (key) => !DRAFT_FIELDS.has(key),
    ) ||
    Object.keys(value).length !==
      DRAFT_FIELDS.size
  ) {
    return false;
  }

  return (
    STRING_DRAFT_FIELDS.every(
      (key) =>
        typeof value[key] === 'string',
    ) &&
    BOOLEAN_DRAFT_FIELDS.every(
      (key) =>
        typeof value[key] === 'boolean',
    ) &&
    FILTER_DRAFT_FIELDS.every(
      (key) =>
        isFilterConfig(value[key]),
    )
  );
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

  for (const key of STRING_DRAFT_FIELDS) {
    const field = value[key];
    if (typeof field === 'string') defaults[key] = field;
  }
  for (const key of BOOLEAN_DRAFT_FIELDS) {
    const field = value[key];
    if (typeof field === 'boolean') defaults[key] = field;
  }
  for (const key of FILTER_DRAFT_FIELDS) {
    defaults[key] = filterField(value, key, defaults[key]);
  }
  return defaults;
};
