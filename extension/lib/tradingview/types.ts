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
}

export interface DetectedStrategy {
  name: string;
  shortTitle?: string;
}

export interface TradingViewMetrics {
  [metric: string]: number;
}
