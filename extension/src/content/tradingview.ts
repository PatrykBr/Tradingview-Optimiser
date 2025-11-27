import type {
  ApplyParamsPayload,
  ContentScriptRequest,
  ContentScriptResponse,
  DateRangePayload,
  ReadMetricsPayload,
  StrategyParameter,
  StrategySummary,
  TrialMetrics,
} from "@shared/ipc";
import { METRIC_TO_PROPERTY } from "@shared/metrics";
import { LABEL_TO_METRIC, METRICS } from "./dom";

const CHANNEL = "tv-optimiser";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function extractStrategiesFromLegend(): StrategySummary[] {
  const strategies: StrategySummary[] = [];
  const legendItems = document.querySelectorAll('[data-name="legend-source-item"]');
  
  legendItems.forEach((item, index) => {
    const titleElement = item.querySelector('[data-name="legend-source-title"]');
    if (titleElement) {
      const name = titleElement.textContent?.trim() || `Strategy ${index + 1}`;
      const strategyId = `${slugify(name)}-${index}`;
      if (!item.hasAttribute("data-tv-optimiser-id")) {
        item.setAttribute("data-tv-optimiser-id", strategyId);
      }
      strategies.push({
        id: strategyId,
        name,
      });
    }
  });
  
  return strategies;
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

  return "";
}

async function fetchParameters(strategyId: string): Promise<StrategyParameter[]> {
  const legendItem = document.querySelector(`[data-tv-optimiser-id="${strategyId}"]`);
  if (!legendItem) {
    throw new Error("Strategy not found");
  }

  const settingsButton = legendItem.querySelector('button[data-name="legend-settings-action"]') as HTMLElement;
  if (!settingsButton) {
    throw new Error("Settings button not found");
  }

  settingsButton.click();
  await sleep(200);

  const dialog = await waitForElement('[data-name="indicator-properties-dialog"]', 5000) as HTMLElement;
  
  const parameters: StrategyParameter[] = [];
  const rows = dialog.querySelectorAll(".cell-RLntasnw.first-RLntasnw");
  
  for (const row of rows) {
    const label = row.textContent?.trim();
    if (!label) continue;
    
    const controlCell = row.nextElementSibling;
    if (!controlCell) continue;
    
    const input = controlCell.querySelector("input, select") as HTMLElement;
    if (!input) continue;
    
    parameters.push({
      id: slugify(label, `param-${parameters.length}`),
      label,
      type: detectParameterType(input),
      value: parseControlValue(input),
    });
  }

  const closeButton = dialog.querySelector('button[data-qa-id="close"]') as HTMLElement;
  if (closeButton) {
    closeButton.click();
  }

  return parameters;
}

async function applyParameters(payload: ApplyParamsPayload): Promise<void> {
  const legendItem = document.querySelector(`[data-tv-optimiser-id="${payload.strategyId}"]`);
  if (!legendItem) {
    throw new Error("Strategy not found");
  }

  const settingsButton = legendItem.querySelector('button[data-name="legend-settings-action"]') as HTMLElement;
  if (!settingsButton) {
    throw new Error("Settings button not found");
  }

  settingsButton.click();
  await sleep(200);

  const dialog = await waitForElement('[data-name="indicator-properties-dialog"]', 5000) as HTMLElement;
  
  const rows = dialog.querySelectorAll(".cell-RLntasnw.first-RLntasnw");
  
  for (const row of rows) {
    const label = row.textContent?.trim();
    if (!label) continue;
    
    const paramId = slugify(label);
    const value = payload.params[paramId];
    if (value === undefined) continue;
    
    const controlCell = row.nextElementSibling;
    if (!controlCell) continue;
    
    const input = controlCell.querySelector("input, select") as HTMLElement;
    if (!input) continue;
    
    if (input instanceof HTMLInputElement) {
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (input instanceof HTMLSelectElement) {
      input.value = String(value);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const submitButton = dialog.querySelector('button[data-name="submit-button"]') as HTMLElement;
  if (submitButton) {
    submitButton.click();
  }

  await sleep(500);
}

function parseMetricValue(text: string): number | undefined {
  const num = Number(text.replace(/−/g, "-").replace(/[%,$\s]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function readMetrics(payload: ReadMetricsPayload): Promise<TrialMetrics> {
  const tester = document.querySelector('[data-name="strategy-tester"]');
  if (!tester) {
    throw new Error("Strategy Tester panel not found. Open the Strategy Tester before running optimisation.");
  }

  await sleep(500);

  const metrics: TrialMetrics = {};
  const requestedProps = payload.metrics.map((m) => METRIC_TO_PROPERTY[m]);

  // Group metrics by tab
  const metricsByTab = new Map<string, Array<keyof TrialMetrics>>();
  for (const prop of requestedProps) {
    const def = METRICS[prop];
    if (!def) continue;
    const list = metricsByTab.get(def.tab) ?? [];
    list.push(prop);
    metricsByTab.set(def.tab, list);
  }

  // Parse overview tab (cards)
  const overviewCards = tester.querySelectorAll(".containerCell-hwB8aI49");
  for (const card of overviewCards) {
    const title = normalizeLabel(card.querySelector(".title-_aP8GmAC")?.textContent);
    const mapping = LABEL_TO_METRIC[title];
    if (!mapping) continue;

    const valueText = card.querySelector(".value-LVMgafTl, .highlightedValue-LVMgafTl")?.textContent;
    const value = parseMetricValue(valueText ?? "");
    if (value !== undefined) {
      metrics[mapping.key] = value;
    }
  }

  // Parse table-based tabs (Performance, Ratios, etc.)
  const tables = tester.querySelectorAll(".ka-table");
  for (const table of tables) {
    const rows = table.querySelectorAll(".ka-row");
    for (const row of rows) {
      const title = normalizeLabel(row.querySelector(".title-NcOKy65p")?.textContent);
      const mapping = LABEL_TO_METRIC[title];
      if (!mapping) continue;

      const cells = row.querySelectorAll(".ka-cell");
      if (cells.length < 2) continue;

      const valueText = cells[1]?.textContent;
      const value = parseMetricValue(valueText ?? "");
      if (value !== undefined) {
        metrics[mapping.key] = value;
      }
    }
  }

  // Ensure we have at least the requested metrics
  const missing = requestedProps.filter((p) => metrics[p] === undefined || Number.isNaN(metrics[p]));
  if (missing.length) {
    throw new Error(`Unable to read metrics: ${missing.join(", ")}`);
  }

  return metrics;
}

async function updateDateRange(payload: DateRangePayload): Promise<void> {
  const chart = (window as any).tvWidget?.activeChart?.();
  const from = Math.floor(new Date(payload.start).getTime() / 1000);
  const to = Math.floor(new Date(payload.end).getTime() / 1000);

  if (chart?.setVisibleRange && Number.isFinite(from) && Number.isFinite(to)) {
    chart.setVisibleRange({ from, to });
  }
}

export async function handleTradingViewMessage(
  request: ContentScriptRequest
): Promise<ContentScriptResponse> {
  if (request.channel !== CHANNEL) {
    return { ok: false, error: "Invalid channel" };
  }

  try {
    switch (request.action) {
      case "list-strategies": {
        const strategies = extractStrategiesFromLegend();
        if (strategies.length === 0) {
          return { ok: false, error: "No strategies found on the active chart. Ensure a strategy is applied." };
        }
        return { ok: true, data: strategies };
      }
      case "get-params": {
        if (!request.payload || typeof request.payload !== "object" || !("strategyId" in request.payload)) {
          return { ok: false, error: "Missing strategyId" };
        }
        const params = await fetchParameters(request.payload.strategyId as string);
        return { ok: true, data: params };
      }
      case "apply-params": {
        if (!request.payload || typeof request.payload !== "object" || !("strategyId" in request.payload)) {
          return { ok: false, error: "Missing payload" };
        }
        await applyParameters(request.payload as ApplyParamsPayload);
        return { ok: true, data: undefined };
      }
      case "read-metrics": {
        if (!request.payload || typeof request.payload !== "object" || !("metrics" in request.payload)) {
          return { ok: false, error: "Missing payload" };
        }
        const metrics = await readMetrics(request.payload as ReadMetricsPayload);
        return { ok: true, data: metrics };
      }
      case "set-date-range": {
        if (!request.payload || typeof request.payload !== "object") {
          return { ok: false, error: "Missing payload" };
        }
        await updateDateRange(request.payload as DateRangePayload);
        return { ok: true, data: undefined };
      }
      default:
        return { ok: false, error: "Unknown action" };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

