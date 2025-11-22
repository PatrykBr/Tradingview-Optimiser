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

export type BackgroundRequest =
  | { type: "list-strategies" }
  | { type: "get-params"; strategyId: string };

export type BackgroundResponse =
  | { type: "strategies"; strategies: StrategySummary[] }
  | { type: "params"; strategyId: string; params: StrategyParameter[] }
  | { type: "error"; message: string };

