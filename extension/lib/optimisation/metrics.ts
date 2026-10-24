import type { ObjectiveDirection } from '../protocol/types';

export interface MetricDefinition {
  key: string;
  label: string;
  direction: ObjectiveDirection;
}

export const OPTIMISATION_METRICS: readonly MetricDefinition[] = [
  { key: 'profitFactor', label: 'Profit Factor', direction: 'maximize' },
  { key: 'netProfitPercent', label: 'Net Profit %', direction: 'maximize' },
  { key: 'sharpeRatio', label: 'Sharpe Ratio', direction: 'maximize' },
  { key: 'sortinoRatio', label: 'Sortino Ratio', direction: 'maximize' },
  {
    key: 'maxDrawdownPercent',
    label: 'Maximum Drawdown %',
    direction: 'minimize',
  },
  {
    key: 'percentProfitable',
    label: 'Percent Profitable',
    direction: 'maximize',
  },
] as const;

export const metricDefinition = (key: string): MetricDefinition =>
  OPTIMISATION_METRICS.find((metric) => metric.key === key) ?? {
    key,
    label: key,
    direction: 'maximize',
  };

export const formatMetric = (key: string, value: number): string => {
  if (!Number.isFinite(value)) return 'Unavailable';

  if (key.toLowerCase().includes('percent') || key === 'netProfitPercent') {
    return value.toFixed(2) + '%';
  }

  if (key === 'totalTrades' || key.endsWith('Trades')) {
    return Math.round(value).toString();
  }

  return Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value.toFixed(3).replace(/\.?0+$/, '');
};
