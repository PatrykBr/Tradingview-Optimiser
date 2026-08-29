export type ObjectiveDirection = 'maximize' | 'minimize';
export type RunStatus =
  | 'created'
  | 'running'
  | 'stop_requested'
  | 'stopped'
  | 'completed'
  | 'failed';

export type SearchParameter =
  | {
      type: 'float';
      name: string;
      low: number;
      high: number;
      step?: number;
      log?: boolean;
    }
  | {
      type: 'int';
      name: string;
      low: number;
      high: number;
      step?: number;
      log?: boolean;
    }
  | {
      type: 'categorical';
      name: string;
      choices: Array<string | number | boolean>;
    };

export interface MetricFilter {
  metric: string;
  operator: 'lte' | 'gte';
  value: number;
}

export interface ChartContext {
  symbol: string;
  timeframe: string;
  strategy_name: string;
}

export interface CreateRun {
  run_id: string;
  objective_metric: string;
  direction: ObjectiveDirection;
  target_trials: number;
  parameters: SearchParameter[];
  filters: MetricFilter[];
  chart: ChartContext;
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
}

export interface RunProgress {
  run_id: string;
  status: RunStatus;
  completed_trials: number;
  target_trials: number;
  failed_trials: number;
  best: BestTrial | null;
  trials: TrialSummary[];
}

export interface Envelope<T = unknown> {
  type: string;
  request_id?: string | null;
  payload: T;
}
