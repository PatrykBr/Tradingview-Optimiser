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

export type ContentScriptAction = "list-strategies";

export interface ContentScriptRequest<T = unknown> {
  channel: "tv-optimiser";
  action: ContentScriptAction;
  payload?: T;
}

export type ContentScriptResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export type BackgroundRequest =
  | { type: "list-strategies" };

export type BackgroundResponse =
  | { type: "strategies"; strategies: StrategySummary[] }
  | { type: "error"; message: string };

