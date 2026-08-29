export type StrategyInputType =
  | 'integer'
  | 'float'
  | 'boolean'
  | 'categorical'
  | 'string'
  | 'time'
  | 'timeframe'
  | 'source'
  | 'unsupported';

export interface StrategyInput {
  id: string;
  label: string;
  type: StrategyInputType;
  currentValue: unknown;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
}

export interface DetectedStrategy {
  id: string;
  name: string;
  shortTitle?: string;
}

export interface TradingViewMetrics {
  [metric: string]: number;
}
