import type {
  ApplyParamsPayload,
  ContentScriptRequest,
  ContentScriptResponse,
  DateRangePayload,
  GetParamsPayload,
  ReadMetricsPayload,
  StrategyParameter,
  StrategySummary,
  TrialMetrics,
} from "@shared/ipc";
import { applyParameters, collectMetrics, fetchParameters, fetchStrategies, updateDateRange } from "./tradingview";

const browser = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? globalThis.chrome;

const CHANNEL = "tv-optimiser";

async function handleRequest(
  request: ContentScriptRequest,
): Promise<ContentScriptResponse<StrategySummary[] | StrategyParameter[] | TrialMetrics | void>> {
  switch (request.action) {
    case "list-strategies": {
      const strategies = await fetchStrategies();
      return { ok: true, data: strategies };
    }
    case "get-params": {
      const payload = request.payload as GetParamsPayload;
      const params = await fetchParameters(payload.strategyId);
      return { ok: true, data: params };
    }
    case "apply-params":
      await applyParameters(request.payload as ApplyParamsPayload);
      return { ok: true, data: undefined };
    case "set-date-range":
      await updateDateRange(request.payload as DateRangePayload);
      return { ok: true, data: undefined };
    case "read-metrics": {
      const metrics = await collectMetrics(request.payload as ReadMetricsPayload);
      return { ok: true, data: metrics };
    }
    default:
      return { ok: false, error: "Unknown action" };
  }
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;
  const typed = message as ContentScriptRequest;
  if (typed.channel !== CHANNEL) return undefined;

  handleRequest(typed)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected content-script error",
      }),
    );

  return true;
});
