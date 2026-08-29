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
