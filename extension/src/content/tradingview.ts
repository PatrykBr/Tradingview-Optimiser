import type {
  ContentScriptRequest,
  ContentScriptResponse,
  StrategyParameter,
  StrategySummary,
} from "@shared/ipc";

const CHANNEL = "tv-optimiser";

function slugify(value: string, fallback = "value"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
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

async function waitForElement(selector: string, timeout = 4000): Promise<Element> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const element = document.querySelector(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
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
  await new Promise((resolve) => setTimeout(resolve, 200));

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

