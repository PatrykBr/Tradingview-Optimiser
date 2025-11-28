import type { FilterComparator, StrategyMetric } from "@shared/ipc";

export const METRIC_OPTIONS: Array<{ id: StrategyMetric; label: string }> = [
  { id: "net-profit", label: "Net Profit" },
  { id: "profit-factor", label: "Profit Factor" },
  { id: "sharpe", label: "Sharpe Ratio" },
  { id: "sortino", label: "Sortino Ratio" },
  { id: "max-dd-pct", label: "Max Drawdown %" },
  { id: "win-rate", label: "Win Rate %" },
  { id: "trades", label: "Number of Trades" },
  { id: "drawdown", label: "Absolute Drawdown" },
];

export const FILTER_COMPARATORS: Array<{
  id: FilterComparator;
  label: string;
}> = [
  { id: ">=", label: "≥" },
  { id: "<=", label: "≤" },
  { id: ">", label: ">" },
  { id: "<", label: "<" },
  { id: "=", label: "=" },
];
