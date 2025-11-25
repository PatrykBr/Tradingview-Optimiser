export type StrategyParameterType = "int" | "float" | "bool" | "string";

export interface StrategyParameter {
  id: string;
  label: string;
  type: StrategyParameterType;
  value: string | number | boolean;
}

export interface StrategySummary {
  id: string;
  name: string;
}

export type ContentScriptAction = "list-strategies" | "get-params";

export interface ContentScriptRequest<T = unknown> {
  channel: "tv-optimiser";
  action: ContentScriptAction;
  payload?: T;
}

export type ContentScriptResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface GetParamsPayload {
  strategyId: string;
}

export interface OptimisationFilter {
  id: string;
  metric: StrategyMetric;
  comparator: FilterComparator;
  value: number;
}

export interface ParameterOptimisationRange {
  min: number;
  max: number;
  step?: number;
}

export interface OptimisationParameterConfig {
  paramId: string;
  label?: string;
  type: StrategyParameterType;
  enabled: boolean;
  range?: ParameterOptimisationRange;
}

export interface OptimisationSettings {
  metric: StrategyMetric;
  trials: number;
  useCustomRange: boolean;
  startDate?: string;
  endDate?: string;
  filters: OptimisationFilter[];
}

export interface OptimisationConfig {
  strategyId: string;
  params: OptimisationParameterConfig[];
  settings: OptimisationSettings;
}

export interface TrialMetrics {
  netProfit?: number;
  profitFactor?: number;
  sharpe?: number;
  sortino?: number;
  maxDrawdownPct?: number;
  winRatePct?: number;
  numberOfTrades?: number;
  [key: string]: number | undefined;
}

export interface TrialResult {
  id: string;
  trial: number;
  params: Record<string, string | number | boolean>;
  metrics: TrialMetrics;
  passedFilters: boolean;
  timestamp: string;
}

export type RunStatus = "idle" | "running" | "stopped" | "completed" | "error";

export type BackgroundRequest =
  | { type: "list-strategies" }
  | { type: "get-params"; strategyId: string }
  | { type: "start-optimisation"; payload: OptimisationConfig }
  | { type: "stop-optimisation" }
  | { type: "get-session" };

export type BackgroundResponse =
  | { type: "strategies"; strategies: StrategySummary[] }
  | { type: "params"; strategyId: string; params: StrategyParameter[] }
  | { type: "optimisation-started" }
  | { type: "optimisation-stopped" }
  | { type: "session"; snapshot: { status: RunStatus; totalTrials: number; completedTrials: TrialResult[] } }
  | { type: "error"; message: string };

export type ExtensionEvent =
  | { type: "status"; status: RunStatus; message?: string }
  | { type: "trial"; payload: { trial: number; params: Record<string, number | string | boolean>; metrics: TrialMetrics; passedFilters: boolean; progress: { completed: number; total: number } } }
  | { type: "complete"; reason: "finished" | "stopped" };

