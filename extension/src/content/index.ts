import type { ContentScriptRequest, ContentScriptResponse, StrategySummary } from "@shared/ipc";

const CHANNEL = "tv-optimiser";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "strategy";
}

function extractStrategiesFromLegend(): StrategySummary[] {
  const strategies: StrategySummary[] = [];
  const legendItems = document.querySelectorAll('[data-name="legend-source-item"]');
  
  legendItems.forEach((item, index) => {
    const titleElement = item.querySelector('[data-name="legend-source-title"]');
    if (titleElement) {
      const name = titleElement.textContent?.trim() || `Strategy ${index + 1}`;
      strategies.push({
        id: `${slugify(name)}-${index}`,
        name,
      });
    }
  });
  
  return strategies;
}

async function handleMessage(
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

chrome.runtime.onMessage.addListener(
  (
    request: ContentScriptRequest,
    _sender,
    sendResponse: (response: ContentScriptResponse) => void
  ) => {
    handleMessage(request).then(sendResponse);
    return true;
  }
);

