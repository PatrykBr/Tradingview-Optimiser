import type { TrialMetrics } from "@shared/ipc";

export type ReportTab = "Overview" | "Performance" | "Trades Analysis" | "Ratios";

export const DOM = {
  attributes: {
    strategyId: "data-tv-optimiser-id",
  },
  legend: {
    item: '[data-name="legend-source-item"]',
    title: '[data-name="legend-source-title"]',
    settingsButtons: ['button[data-name="legend-settings-action"]', 'button[aria-label*="Settings"]'],
  },
  settingsDialog: {
    root: '[data-name="indicator-properties-dialog"]',
    closeButtons: ['button[data-qa-id="close"]', 'button[data-name="close"]'],
    submitButtons: ['button[data-name="submit-button"]', 'button[data-name="ok"]'],
    rows: {
      labelCell: ".cell-RLntasnw.first-RLntasnw",
    },
  },
  tester: {
    panel: '[data-name="strategy-tester"], [data-role="strategy-tester"]',
    presenceSelectors: [
      '[data-name="strategy-tester"]',
      '[data-name="strategy-tester-content"]',
      "#report-tabs",
    ],
  },
} as const;

interface MetricDefinition {
  tab: ReportTab;
  labels: string[];
  preferPercent?: boolean;
}

export const METRICS: Record<keyof TrialMetrics, MetricDefinition> = {
  netProfit: {
    tab: "Overview",
    labels: ["total p&l", "net profit"],
  },
  numberOfTrades: {
    tab: "Overview",
    labels: ["total trades"],
  },
  winRatePct: {
    tab: "Overview",
    labels: ["profitable trades", "percent profitable"],
    preferPercent: true,
  },
  profitFactor: {
    tab: "Overview",
    labels: ["profit factor"],
  },
  sharpe: {
    tab: "Ratios",
    labels: ["sharpe ratio"],
  },
  sortino: {
    tab: "Ratios",
    labels: ["sortino ratio"],
  },
  maxDrawdownPct: {
    tab: "Overview",
    labels: ["max equity drawdown"],
    preferPercent: true,
  },
};

export const LABEL_TO_METRIC: Record<
  string,
  { key: keyof TrialMetrics; preferPercent?: boolean }
> = Object.fromEntries(
  (Object.entries(METRICS) as Array<[keyof TrialMetrics, MetricDefinition]>).flatMap(([key, def]) =>
    def.labels.map((label) => [label, { key, preferPercent: def.preferPercent }]),
  ),
);

