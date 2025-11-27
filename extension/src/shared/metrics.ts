import type { StrategyMetric, TrialMetrics } from "./ipc";

/**
 * Single source of truth mapping StrategyMetric IDs to TrialMetrics property keys.
 * Used by background worker, content scripts, and popup components.
 */
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
