export type ObjectiveDirection = 'maximize' | 'minimize';
export type RunStatus =
  'created' | 'running' | 'stop_requested' | 'stopped' | 'completed' | 'failed';

export type Primitive = string | number | boolean;

export interface ParameterCondition {
  parameter: string;
  values: Primitive[];
}

export type SearchParameter =
  | {
      type: 'float';
      name: string;
      low: number;
      high: number;
      step?: number;
      log?: boolean;
      condition?: ParameterCondition;
    }
  | {
      type: 'int';
      name: string;
      low: number;
      high: number;
      step?: number;
      log?: boolean;
      condition?: ParameterCondition;
    }
  | {
      type: 'categorical';
      name: string;
      choices: Primitive[];
      condition?: ParameterCondition;
    };

export interface MetricFilter {
  metric: string;
  operator: 'lte' | 'gte';
  value: number;
}

export interface BacktestRange {
  mode: 'deep';
  start_date: string;
  end_date: string;
}

export interface ConvergenceConfig {
  enabled: boolean;
  min_trials: number;
  patience: number;
  min_improvement_percent: number;
}

export interface RobustnessConfig {
  enabled: boolean;
  full_range?: BacktestRange | null;
  validation_fraction: number;
  folds: number;
  top_candidates: number;
}

export interface StabilityConfig {
  enabled: boolean;
  perturbation_percent: number;
}

export interface WalkForwardConfig {
  enabled: boolean;
  full_range?: BacktestRange | null;
  folds: number;
  trials_per_fold: number;
  initial_training_fraction: number;
}

export interface MonteCarloConfig {
  enabled: boolean;
  simulations: number;
  confidence: number;
}

export interface ResearchConfig {
  convergence: ConvergenceConfig;
  robustness: RobustnessConfig;
  stability: StabilityConfig;
  walk_forward?: WalkForwardConfig;
  monte_carlo?: MonteCarloConfig;
}

export interface ChartContext {
  symbol: string;
  timeframe: string;
  strategy_name: string;
  strategy_signature: string;
  strategy_settings_signature?: string | null;
}

export interface CreateRun {
  run_id: string;
  objective_metric: string;
  direction: ObjectiveDirection;
  target_trials: number;
  parameters: SearchParameter[];
  filters: MetricFilter[];
  chart: ChartContext;
  backtest_range?: BacktestRange | null;
  baseline_parameters?: Record<string, Primitive>;
  research?: ResearchConfig;
}

export interface NextTrial {
  run_id: string;
  trial_number: number;
  parameters: Record<string, unknown>;
}

export interface TrialResult {
  run_id: string;
  trial_number: number;
  metrics: Record<string, number>;
  duration_ms?: number;
}

export type BackendCommand =
  | { type: 'CREATE_RUN'; payload: CreateRun }
  | { type: 'START_RUN' | 'STOP_RUN' | 'DELETE_RUN'; payload: { run_id: string } }
  | { type: 'ABORT_RUN'; payload: { run_id: string; reason?: string } }
  | { type: 'GET_RUN_ANALYSIS'; payload: { run_id: string; config: CreateRun } }
  | { type: 'TRIAL_RESULT'; payload: TrialResult }
  | { type: 'TRIAL_FAILED'; payload: { run_id: string; trial_number: number; reason: string } };

export interface BestTrial {
  trial_number: number;
  objective_value: number;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  constraints: Record<string, number>;
}

export interface TrialSummary {
  trial_number: number;
  state: 'complete' | 'failed';
  objective_value: number | null;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  constraints: Record<string, number>;
  failure_reason: string | null;
  duration_ms: number | null;
  reused_from_trial?: number | null;
}

export interface RunProgress {
  run_id: string;
  status: RunStatus;
  completed_trials: number;
  target_trials: number;
  failed_trials: number;
  reused_trials?: number;
  best: BestTrial | null;
  termination_reason?: 'target_trials' | 'converged' | 'search_space_exhausted' | 'user' | null;
  trials: TrialSummary[];
}

export interface RunUpdate extends Omit<RunProgress, 'trials'> {
  trial_updates: TrialSummary[];
}

export interface RunAnalysis {
  run_id: string;
  parameter_importance: Record<string, number>;
  parameter_importance_status: 'available' | 'insufficient_data' | 'not_applicable' | 'failed';
  parameter_importance_error: string | null;
  completed_trials: number;
}

export interface Envelope<T = unknown> {
  type: string;
  request_id?: string | null;
  payload: T;
}
