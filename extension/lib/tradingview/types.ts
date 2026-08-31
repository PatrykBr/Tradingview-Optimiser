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

export interface TradingViewReportSnapshot {
  metrics: TradingViewMetrics | null;
  token: string | null;
  objectId: number | null;
  backtestRange: {
    from: number;
    to: number;
  } | null;
  settingsSignature: string | null;
  error: string | null;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface TradingViewRunContextSnapshot {
  symbol: string;
  timeframe: string;
  strategySignature: string;
  inputs: StrategyInput[];
  backtestMode: 'chart' | 'deep';
  backtestRange: {
    from: number;
    to: number;
  } | null;
  settingsSignature: string | null;
}

export interface TradingViewDiagnostics {
  checks: DiagnosticCheck[];
  deepBacktesting: {
    available: boolean;
    reason: string | null;
  };
}

export interface DeepBacktestResult {
  supported: boolean;
  applied: boolean;
  reason: string | null;
}
