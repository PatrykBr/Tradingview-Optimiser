import type { TrialMetrics } from "@shared/ipc";

export type ReportTab = "Overview" | "Performance" | "Trades Analysis" | "Ratios";

export type CardSelectors = {
  card: string;
  title: string;
  change: string;
  value: string;
};

export type TableSelectors = {
  rows: string;
  title: string;
  cell: string;
  percentValue: string;
  numericValue: string;
};

interface TabBase {
  id: string;
  label: string;
}

export type CardTabConfig = TabBase & {
  kind: "cards";
  selectors: CardSelectors;
  root?: string;
};
export type TableTabConfig = TabBase & {
  kind: "table";
  selectors: TableSelectors;
  root?: string;
};
export type ReportTabConfig = CardTabConfig | TableTabConfig;

interface MetricDefinition {
  tab: ReportTab;
  labels: string[];
  preferPercent?: boolean;
  preferChange?: boolean;
}

export const DOM = {
  attributes: {
    strategyId: "data-tv-optimiser-id",
  },
  legend: {
    item: '[data-name="legend-source-item"]',
    title: '[data-name="legend-source-title"]',
    panel: '[data-name="legend-source-panel"]',
    settingsButtons: ['button[data-name="legend-settings-action"]', 'button[aria-label*="Settings"]'],
  },
  settingsDialog: {
    root: '[data-name="indicator-properties-dialog"]',
    closeButtons: ['button[data-qa-id="close"]', 'button[data-name="close"]', 'button[aria-label="Close"]'],
    submitButtons: ['button[data-name="submit-button"]', 'button[data-name="ok"]'],
    rows: {
      labelCell: ".cell-RLntasnw.first-RLntasnw",
      booleanRow: ".cell-RLntasnw.fill-RLntasnw label.checkbox-Lah5SRBd",
      booleanLabel: ".label-Lah5SRBd",
    },
  },
  controls: {
    direct: 'input, select, textarea, button[role="combobox"]',
    editableFallbacks: [
      'input[data-qa-id="ui-lib-Input-input"]',
      'input[type="number"]',
      'input[type="text"]',
      "input",
      "select",
      "textarea",
      'button[role="combobox"]',
    ],
    comboboxValueSlot: ".middleSlot-pzM0w4il",
  },
  tester: {
    panel: '[data-name="strategy-tester"], [data-role="strategy-tester"]',
    presenceSelectors: [
      '[data-name="strategy-tester"], [data-role="strategy-tester"]',
      '[data-name="strategy-tester-content"]',
      ".tabsContainer-WvFM90JY",
      ".reportContainerOld-NyzFj5yn",
      ".wrapper-UQYV_qXv",
      "#report-tabs",
    ],
    toggleButtons: [
      'button[aria-label="Strategy Tester"]',
      'button[aria-label*="Strategy Tester"]',
      'button[data-overflow-tooltip-text="Strategy Tester"]',
      '[data-name="bottom-toolbar"] button[data-name="strategy-tester"]',
      '[data-name="header-toolbar"] button[title*="Strategy Tester"]',
      '[data-name="pane-toolbar-button"][data-name="strategy-tester"]',
    ],
    snackbar: '[data-qa-id="backtesting-loading-report-snackbar"]',
    snackbarMessage: ".clamp-ysAeZQp3",
  },
  reportTabs: {
    container: "#report-tabs",
    labelAttribute: "data-overflow-tooltip-text",
  },
} as const;

const OVERVIEW_CARD_SCOPE = ".reportContainerOld-NyzFj5yn .container-AXqPXerm";

const OVERVIEW_SELECTORS: CardSelectors = {
  card: ".containerCell-hwB8aI49",
  title: ".title-_aP8GmAC",
  change: ".change-LVMgafTl, .percentValue-SLJfw5le",
  value: ".highlightedValue-LVMgafTl, .value-LVMgafTl, .valueValue-l31H9iuA",
};

const REPORT_TABLE_SELECTORS: TableSelectors = {
  rows: ".ka-table .ka-row",
  title: ".title-NcOKy65p",
  cell: ".ka-cell",
  percentValue: ".percentValue-SLJfw5le",
  numericValue: ".value-SLJfw5le, .value-LVMgafTl",
};

export const REPORT_TABS: Record<ReportTab, ReportTabConfig> = {
  Overview: {
    id: "Overview",
    label: "Overview",
    kind: "cards",
    root: OVERVIEW_CARD_SCOPE,
    selectors: OVERVIEW_SELECTORS,
  },
  Performance: {
    id: "Performance",
    label: "Performance",
    kind: "table",
    selectors: REPORT_TABLE_SELECTORS,
  },
  "Trades Analysis": {
    id: "Trades Analysis",
    label: "Trades analysis",
    kind: "table",
    selectors: REPORT_TABLE_SELECTORS,
  },
  Ratios: {
    id: "Ratios",
    label: "Risk/performance ratios",
    kind: "table",
    selectors: REPORT_TABLE_SELECTORS,
  },
};

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
    preferChange: true,
  },
};

export const LABEL_TO_METRIC: Record<
  string,
  { key: keyof TrialMetrics; preferPercent?: boolean; preferChange?: boolean }
> = Object.fromEntries(
  (Object.entries(METRICS) as Array<[keyof TrialMetrics, MetricDefinition]>).flatMap(([key, def]) =>
    def.labels.map((label) => [label, { key, preferPercent: def.preferPercent, preferChange: def.preferChange }]),
  ),
);
