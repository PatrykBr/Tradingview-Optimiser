// ============================================================
// Strategy Discovery
// ============================================================

export interface StrategyInfo {
  name: string;
  index: number;
  isActive: boolean;
}

// ============================================================
// Parameter Types
// ============================================================

export type ParameterType = 'numeric' | 'checkbox' | 'dropdown';

export interface BaseParameter {
  id: string;
  label: string;
  section: string;
  type: ParameterType;
  enabled: boolean; // whether to include in optimization
}

export interface NumericParameter extends BaseParameter {
  type: 'numeric';
  currentValue: number;
  min: number;
  max: number;
  step: number;
}

export interface CheckboxParameter extends BaseParameter {
  type: 'checkbox';
  currentValue: boolean;
  optimize: boolean; // whether to try both true/false
}

export interface DropdownParameter extends BaseParameter {
  type: 'dropdown';
  currentValue: string;
  options: string[];
  selectedOptions: string[]; // subset to test during optimization
}

export type StrategyParameter = NumericParameter | CheckboxParameter | DropdownParameter;

// ============================================================
// Metric Types
// ============================================================

export interface Metric {
  name: string;
  value: string;
  numericValue: number;
  currency?: string;
  percentValue?: string;
  column: 'all' | 'long' | 'short';
  section: string;
  isPositive?: boolean;
  isNegative?: boolean;
}

export interface MetricDefinition {
  name: string;
  section: string;
  isFavorite: boolean;
  direction: 'maximize' | 'minimize';
}

// ============================================================
// Filter Types
// ============================================================

export type FilterOperator = '>=' | '<=' | '>' | '<' | '==' | '!=';

export interface Filter {
  id: string;
  metricName: string;
  operator: FilterOperator;
  value: number;
  enabled: boolean;
}

// ============================================================
// Trial Types
// ============================================================

export interface TrialParams {
  [paramId: string]: number | boolean | string;
}

export interface TrialResult {
  trialNumber: number;
  params: TrialParams;
  metrics: Metric[];
  objectiveValue: number;
  passedFilters: boolean;
  filterFailures: string[];
  timestamp: number;
  duration: number;
}

export interface TrialHistoryRun {
  id: string;
  familyName: string;
  studyName: string;
  strategyName: string;
  runMode: RunMode;
  startedAt: number;
  completedAt: number;
  trials: TrialResult[];
}

// ============================================================
// Optimization State
// ============================================================

export type OptimizationStatus = 'idle' | 'detecting' | 'running' | 'paused' | 'completed' | 'error';

export interface OptimizationConfig {
  id: string;
  name: string;
  strategyName: string;
  strategyIndex: number;
  runMode: RunMode;
  selectedHistoryRunIds: string[];
  sampler: SamplerChoice;
  targetMetric: string;
  targetMetricDirection: 'maximize' | 'minimize';
  targetMetricColumn: 'all' | 'long' | 'short';
  totalTrials: number;
  parameters: StrategyParameter[];
  filters: Filter[];
  antiDetection: AntiDetectionConfig;
  createdAt: number;
  updatedAt: number;
}

export interface AntiDetectionConfig {
  enabled: boolean;
  minDelay: number; // ms
  maxDelay: number; // ms
}

export type SamplerChoice = 'auto' | 'tpe' | 'random' | 'gp' | 'qmc' | 'cmaes';
export type RunMode = 'resume' | 'fresh' | 'warm_start';

export interface OptimizationState {
  status: OptimizationStatus;
  config: OptimizationConfig | null;
  currentTrial: number;
  trials: TrialResult[];
  historyTrials: TrialResult[];
  historyRuns: TrialHistoryRun[];
  resumeAvailable: boolean;
  bestTrial: TrialResult | null;
  error: string | null;
  startTime: number | null;
  pausedAt: number | null;
}

// ============================================================
// Backend Connection
// ============================================================

export type BackendStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ============================================================
// Configuration Management
// ============================================================

export interface SavedConfig {
  id: string;
  name: string;
  strategyName: string;
  config: Omit<OptimizationConfig, 'id' | 'createdAt' | 'updatedAt'>;
  createdAt: number;
  updatedAt: number;
}
