import type {
  ApplyParamsPayload,
  DateRangePayload,
  ReadMetricsPayload,
  StrategyParameter,
  StrategySummary,
  TrialMetrics,
} from "@shared/ipc";
import { METRIC_TO_PROPERTY } from "@shared/metrics";
import {
  DOM,
  LABEL_TO_METRIC,
  METRICS,
  REPORT_TABS,
  type CardSelectors,
  type ReportTab,
  type ReportTabConfig,
  type TableSelectors,
} from "./dom";

type ChartWindow = Window &
  typeof globalThis & {
    tvWidget?: {
      activeChart?: () => {
        setVisibleRange?: (range: { from: number; to: number }) => void;
      };
    };
  };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class AsyncMutex {
  private waiters: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    return () => {
      const next = this.waiters.shift();
      if (next) next();
      else this.locked = false;
    };
  }
}

const dialogMutex = new AsyncMutex();

function slugify(value: string, fallback = "value"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

async function waitForElement(selector: string, timeout = 4000): Promise<Element> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const element = document.querySelector(selector);
    if (element) return element;
    await sleep(100);
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

function queryFirst<T extends Element>(root: ParentNode | Document, selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

function ensureStrategyIds(): void {
  document.querySelectorAll<HTMLElement>(DOM.legend.item).forEach((item, index) => {
    if (item.hasAttribute(DOM.attributes.strategyId)) return;
    const title = item.querySelector<HTMLElement>(DOM.legend.title)?.textContent;
    item.setAttribute(DOM.attributes.strategyId, `${slugify(title ?? `strategy-${index}`)}-${index}`);
  });
}

function extractStrategiesFromLegend(): StrategySummary[] {
  ensureStrategyIds();
  const items = document.querySelectorAll<HTMLElement>(`[${DOM.attributes.strategyId}]`);
  const strategies: StrategySummary[] = [];

  for (const item of items) {
    const title = item.querySelector<HTMLElement>(DOM.legend.title);
    if (!title) continue;
    strategies.push({
      id: item.getAttribute(DOM.attributes.strategyId) ?? slugify(title.textContent ?? "strategy"),
      name: title.textContent?.trim() ?? "Strategy",
    });
  }
  return strategies;
}

function fireMouseEvent(target: Element, type: string): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
}

async function withSettingsDialog<T>(
  strategyId: string,
  handler: (dialog: HTMLElement) => Promise<T>,
): Promise<T | null> {
  const release = await dialogMutex.acquire();
  let dialog: HTMLElement | null = null;

  try {
    ensureStrategyIds();
    const legendItem = document.querySelector<HTMLElement>(`[${DOM.attributes.strategyId}="${strategyId}"]`);
    if (!legendItem) return null;

    const settingsButton = queryFirst<HTMLElement>(legendItem, DOM.legend.settingsButtons);
    if (!settingsButton) {
      console.warn("Settings button not found for strategy", strategyId);
      return null;
    }

    fireMouseEvent(settingsButton, "mousedown");
    fireMouseEvent(settingsButton, "mouseup");
    await sleep(150);

    dialog = (await waitForElement(DOM.settingsDialog.root, 7000)) as HTMLElement;
    return await handler(dialog);
  } catch (error) {
    console.warn("Unable to open settings dialog", error);
    return null;
  } finally {
    queryFirst<HTMLElement>(dialog ?? document, DOM.settingsDialog.closeButtons)?.click();
    release();
  }
}

function detectParameterType(input: HTMLElement | null): StrategyParameter["type"] {
  if (input instanceof HTMLInputElement) {
    if (input.type === "checkbox") return "bool";
    if (input.type === "number" || input.type === "text") {
      return Number.isInteger(parseFloat(input.value)) ? "int" : "float";
    }
  }
  return "string";
}

function parseControlValue(input: HTMLElement | null): string | number | boolean {
  if (!input) return "";

  if (input instanceof HTMLInputElement) {
    if (input.type === "checkbox") return input.checked;
    const num = Number(input.value);
    return Number.isFinite(num) ? num : input.value;
  }

  if (input instanceof HTMLSelectElement) return input.value;

  if (input instanceof HTMLButtonElement && input.getAttribute("role") === "combobox") {
    return (
      input.querySelector<HTMLElement>(DOM.controls.comboboxValueSlot)?.textContent?.trim() ??
      input.textContent?.trim() ??
      ""
    );
  }

  return "";
}

function getControlFromCell(cell: HTMLElement | null): HTMLElement | null {
  if (!cell) return null;
  if (cell.matches(DOM.controls.direct)) return cell;
  const el = queryFirst<HTMLElement>(cell, DOM.controls.editableFallbacks);
  if (!el) return null;
  return el.matches(DOM.controls.direct) ? el : (queryFirst<HTMLElement>(el, DOM.controls.editableFallbacks) ?? el);
}

interface DialogField {
  id: string;
  label: string;
  control: HTMLElement;
  value: string | number | boolean;
  type: StrategyParameter["type"];
}

function extractDialogFields(dialog: HTMLElement): DialogField[] {
  const fields: DialogField[] = [];

  for (const labelCell of dialog.querySelectorAll<HTMLElement>(DOM.settingsDialog.rows.labelCell)) {
    const label = labelCell.textContent?.trim();
    if (!label) continue;
    const control = getControlFromCell(labelCell.nextElementSibling as HTMLElement | null);
    if (!control) continue;
    fields.push({
      id: slugify(label, `param-${fields.length}`),
      label,
      control,
      type: detectParameterType(control),
      value: parseControlValue(control),
    });
  }

  for (const row of dialog.querySelectorAll<HTMLElement>(DOM.settingsDialog.rows.booleanRow)) {
    const label = row.querySelector(DOM.settingsDialog.rows.booleanLabel)?.textContent?.trim();
    const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!label || !input) continue;
    fields.push({
      id: slugify(label, `param-${fields.length}`),
      label,
      control: input,
      type: "bool",
      value: input.checked,
    });
  }

  return fields;
}

function setControlValue(control: HTMLElement | null, value: string | number | boolean): void {
  if (!control) return;

  if (control instanceof HTMLInputElement) {
    control.disabled = false;
    control.focus({ preventScroll: true });
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
    } else {
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.blur();
    return;
  }

  if (control instanceof HTMLSelectElement) {
    control.focus({ preventScroll: true });
    control.value = String(value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.blur();
    return;
  }

  if (control instanceof HTMLButtonElement && control.getAttribute("role") === "combobox") {
    console.warn("Combobox parameter updates are not yet automated");
  }
}

export async function applyParameters(payload: ApplyParamsPayload): Promise<void> {
  const result = await withSettingsDialog(payload.strategyId, async (dialog) => {
    const fieldMap = new Map(extractDialogFields(dialog).map((f) => [f.id, f]));
    for (const [paramId, value] of Object.entries(payload.params)) {
      setControlValue(fieldMap.get(paramId)?.control ?? null, value);
    }
    queryFirst<HTMLElement>(dialog, DOM.settingsDialog.submitButtons)?.click();
    return true;
  });
  if (result) await waitForReportUpdate();
}

function clickStrategyTesterToggle(): boolean {
  const button = queryFirst<HTMLElement>(document, DOM.tester.toggleButtons);
  if (!button) return false;
  fireMouseEvent(button, "click");
  return true;
}

async function ensureStrategyTester(): Promise<HTMLElement | null> {
  const existing = queryFirst<HTMLElement>(document, DOM.tester.presenceSelectors);
  if (existing) return existing;

  const toggled = clickStrategyTesterToggle();
  try {
    return (await waitForElement(DOM.tester.panel, toggled ? 8000 : 2000)) as HTMLElement;
  } catch {
    return queryFirst<HTMLElement>(document, DOM.tester.presenceSelectors);
  }
}

function parseMetricValue(text: string): number | undefined {
  const num = Number(text.replace(/−/g, "-").replace(/[%,$\s]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

const resolveScope = (root?: string): ParentNode =>
  root ? (document.querySelector<HTMLElement>(root) ?? document) : document;

const getText = (el: Element | null, selector: string) => el?.querySelector<HTMLElement>(selector)?.textContent ?? "";

function parseCardTab(config: { selectors: CardSelectors; root?: string }): Partial<TrialMetrics> {
  const result: Partial<TrialMetrics> = {};
  for (const card of resolveScope(config.root).querySelectorAll<HTMLElement>(config.selectors.card)) {
    const mapping = LABEL_TO_METRIC[normalizeLabel(getText(card, config.selectors.title))];
    if (!mapping) continue;

    const changeVal = parseMetricValue(getText(card, config.selectors.change));
    const mainVal = parseMetricValue(getText(card, config.selectors.value));
    const value = mapping.preferChange || mapping.preferPercent ? (changeVal ?? mainVal) : mainVal;

    if (value !== undefined) result[mapping.key] = value;
  }
  return result;
}

function parseReportTable(config: { selectors: TableSelectors; root?: string }): Partial<TrialMetrics> {
  const result: Partial<TrialMetrics> = {};
  for (const row of resolveScope(config.root).querySelectorAll<HTMLElement>(config.selectors.rows)) {
    const mapping = LABEL_TO_METRIC[normalizeLabel(getText(row, config.selectors.title))];
    if (!mapping) continue;

    const cells = row.querySelectorAll<HTMLElement>(config.selectors.cell);
    if (cells.length < 2) continue;

    const pct = parseMetricValue(getText(cells[1], config.selectors.percentValue));
    const num = parseMetricValue(getText(cells[1], config.selectors.numericValue));
    const value = mapping.preferPercent ? (pct ?? num) : num;

    if (value !== undefined) result[mapping.key] = value;
  }
  return result;
}

const REPORT_TAB_PARSERS: Record<ReportTab, () => Partial<TrialMetrics>> = Object.fromEntries(
  (Object.entries(REPORT_TABS) as Array<[ReportTab, ReportTabConfig]>).map(([tab, config]) => {
    const parser = config.kind === "cards" ? () => parseCardTab(config) : () => parseReportTable(config);
    return [tab, parser];
  }),
) as Record<ReportTab, () => Partial<TrialMetrics>>;

async function waitForReportUpdate(timeout = 15000): Promise<void> {
  const start = performance.now();
  let sawLoading = false;

  while (performance.now() - start < timeout) {
    const snackbar = document.querySelector<HTMLElement>(DOM.tester.snackbar);
    const message = snackbar?.querySelector<HTMLElement>(DOM.tester.snackbarMessage)?.textContent?.toLowerCase() ?? "";

    if (message.includes("updating report")) sawLoading = true;
    if (message.includes("updated successfully")) {
      await sleep(500);
      return;
    }
    if (!snackbar && sawLoading) {
      await sleep(300);
      return;
    }

    await sleep(200);
  }

  if (sawLoading) throw new Error("Strategy Tester did not finish updating the report in time.");
}

async function selectReportTab(tab: ReportTab): Promise<boolean> {
  const tabList = document.querySelector(DOM.reportTabs.container);
  const config = REPORT_TABS[tab];
  if (!tabList || !config) return false;

  const escapedId = CSS.escape?.(config.id) ?? config.id;
  const labelAttr = DOM.reportTabs.labelAttribute;

  const button =
    tabList.querySelector<HTMLButtonElement>(`button#${escapedId}`) ??
    [...tabList.querySelectorAll<HTMLButtonElement>(`button[${labelAttr}]`)].find(
      (btn) => btn.getAttribute(labelAttr)?.toLowerCase().trim() === config.label.toLowerCase(),
    );

  if (!button) return false;
  if (button.getAttribute("aria-selected") !== "true") {
    fireMouseEvent(button, "click");
    await sleep(100);
  }
  return true;
}

export async function fetchStrategies(): Promise<StrategySummary[]> {
  const strategies = extractStrategiesFromLegend();
  if (!strategies.length) {
    throw new Error("No strategies found on the active chart. Ensure a strategy is applied.");
  }
  return strategies;
}

export async function fetchParameters(strategyId: string): Promise<StrategyParameter[]> {
  const result = await withSettingsDialog(strategyId, async (dialog) => {
    await sleep(50);
    return extractDialogFields(dialog).map(({ id, label, type, value }) => ({ id, label, type, value }));
  });
  if (!result?.length) {
    throw new Error("Unable to read strategy parameters from the TradingView dialog.");
  }
  return result;
}

export async function updateDateRange(payload: DateRangePayload): Promise<void> {
  const chart = (window as ChartWindow).tvWidget?.activeChart?.();
  const from = Math.floor(new Date(payload.start).getTime() / 1000);
  const to = Math.floor(new Date(payload.end).getTime() / 1000);

  if (chart?.setVisibleRange && Number.isFinite(from) && Number.isFinite(to)) {
    chart.setVisibleRange({ from, to });
  } else {
    console.warn("Chart API unavailable; date range not applied");
  }
}

export async function collectMetrics(payload: ReadMetricsPayload): Promise<TrialMetrics> {
  const tester = await ensureStrategyTester();
  if (!tester) {
    throw new Error("Strategy Tester panel not found. Open the Strategy Tester before running optimisation.");
  }
  await sleep(500);

  const requestedProps = payload.metrics.map((m) => METRIC_TO_PROPERTY[m]);
  const metrics: TrialMetrics = {};

  // Group metrics by tab
  const metricsByTab = new Map<ReportTab, Array<keyof TrialMetrics>>();
  for (const prop of requestedProps) {
    const def = METRICS[prop];
    if (!def) continue;
    const list = metricsByTab.get(def.tab) ?? [];
    list.push(prop);
    metricsByTab.set(def.tab, list);
  }

  // Parse each tab
  for (const [tab, propsInTab] of metricsByTab) {
    if (!(await selectReportTab(tab))) {
      console.warn(`Failed to switch to tab: ${tab}`);
      continue;
    }
    await sleep(300);
    const parsed = REPORT_TAB_PARSERS[tab]();
    for (const prop of propsInTab) {
      const value = parsed[prop];
      if (typeof value === "number" && !Number.isNaN(value)) {
        metrics[prop] = value;
      }
    }
  }

  const missing = requestedProps.filter((p) => metrics[p] === undefined || Number.isNaN(metrics[p]));
  if (missing.length) {
    throw new Error(`Unable to read metrics: ${missing.join(", ")}`);
  }

  return metrics;
}
