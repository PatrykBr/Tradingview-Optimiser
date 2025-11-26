import type { StrategyMetric, TrialMetrics } from "./ipc";

export const METRIC_TO_PROPERTY: Record<StrategyMetric, keyof TrialMetrics> = {
  "net-profit": "netProfit",
  "profit-factor": "profitFactor",
  sharpe: "sharpe",
  sortino: "sortino",
  "max-dd-pct": "maxDrawdownPct",
  "win-rate": "winRatePct",
  trades: "numberOfTrades",
  drawdown: "maxDrawdownPct",
  custom: "netProfit",
};

