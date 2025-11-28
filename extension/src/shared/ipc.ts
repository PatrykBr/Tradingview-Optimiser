export type StrategyParameterType = "int" | "float" | "bool" | "string" | "source" | "resolution";

export interface StrategyParameter {
  id: string;
  label: string;
  type: StrategyParameterType;
  value: string | number | boolean;
}

export interface StrategySummary {
  id: string;
  name: string;
  author?: string;
}

export type StrategyMetric =
  | "net-profit"
  | "profit-factor"
  | "sharpe"
  | "sortino"
  | "max-dd-pct"
  | "win-rate"
  | "trades"
  | "drawdown"
  | "custom";

export type FilterComparator = ">=" | "<=" | "=" | ">" | "<";

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
  filterReasons?: string[];
  timestamp: string;
}

export type RunStatus = "idle" | "running" | "stopped" | "completed" | "error";

export interface OptimisationSessionSnapshot {
  status: RunStatus;
  statusMessage?: string;
  config?: OptimisationConfig;
  totalTrials: number;
  completedTrials: TrialResult[];
  bestTrial?: TrialResult | null;
}

export type BackgroundRequest =
  | { type: "list-strategies" }
  | { type: "get-params"; strategyId: string }
  | { type: "start-optimisation"; payload: OptimisationConfig }
  | { type: "stop-optimisation" }
  | { type: "get-session" }
  | { type: "apply-best-params" };

export type BackgroundResponse =
  | { type: "strategies"; strategies: StrategySummary[] }
  | { type: "params"; strategyId: string; params: StrategyParameter[] }
  | { type: "optimisation-started" }
  | { type: "optimisation-stopped" }
  | { type: "session"; snapshot: OptimisationSessionSnapshot }
  | { type: "best-applied" }
  | { type: "error"; message: string };

export type ContentScriptAction = "list-strategies" | "get-params" | "apply-params" | "read-metrics" | "set-date-range";

export interface ContentScriptRequest<T = unknown> {
  channel: "tv-optimiser";
  action: ContentScriptAction;
  payload?: T;
}

export type ContentScriptResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface GetParamsPayload {
  strategyId: string;
}

export interface ApplyParamsPayload {
  strategyId: string;
  params: Record<string, string | number | boolean>;
}

export interface DateRangePayload {
  start: string;
  end: string;
}

export interface ReadMetricsPayload {
  metrics: StrategyMetric[];
}

export interface TrialBroadcast {
  trial: number;
  params: Record<string, number | string | boolean>;
  metrics: TrialMetrics;
  passedFilters: boolean;
  filterReasons?: string[];
  objective: number;
  progress: { completed: number; total: number };
  best?: TrialResult | null;
}

export type ExtensionEvent =
  | { type: "status"; status: RunStatus; message?: string }
  | { type: "trial"; payload: TrialBroadcast }
  | {
      type: "complete";
      reason: "finished" | "stopped";
      best?: TrialResult | null;
    };
