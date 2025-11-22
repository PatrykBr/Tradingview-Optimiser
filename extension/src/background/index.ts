import browser from "webextension-polyfill";
import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentScriptRequest,
  ContentScriptResponse,
  GetParamsPayload,
  StrategyParameter,
  StrategySummary,
} from "@shared/ipc";

const CHANNEL = "tv-optimiser";

browser.runtime.onInstalled.addListener(() => {
  console.info("TV Optimiser background service worker installed");
});

async function resolveTradingViewTabId(): Promise<number | undefined> {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.includes("tradingview.com") && typeof active.id === "number") {
    return active.id;
  }
  const [fallback] = await browser.tabs.query({ url: "*://*.tradingview.com/*" });
  return fallback?.id ?? active?.id;
}

async function sendToContent<TResponse, TPayload = unknown>(
  action: ContentScriptRequest["action"],
  payload?: TPayload,
): Promise<ContentScriptResponse<TResponse>> {
  const tabId = await resolveTradingViewTabId();
  if (!tabId) {
    return { ok: false, error: "Open your TradingView chart first." };
  }

  const request: ContentScriptRequest<TPayload> = {
    channel: CHANNEL,
    action,
    payload,
  };

  try {
    return (await browser.tabs.sendMessage(tabId, request)) as ContentScriptResponse<TResponse>;
  } catch (error) {
    console.warn("Failed to reach content script", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to reach TradingView tab.",
    };
  }
}

async function handleBackgroundRequest(message: BackgroundRequest): Promise<BackgroundResponse> {
  switch (message.type) {
    case "list-strategies": {
      const response = await sendToContent<StrategySummary[]>("list-strategies");
      return response.ok
        ? { type: "strategies", strategies: response.data }
        : { type: "error", message: response.error ?? "Unable to list strategies." };
    }
    case "get-params": {
      const response = await sendToContent<StrategyParameter[], GetParamsPayload>("get-params", {
        strategyId: message.strategyId,
      });
      return response.ok
        ? { type: "params", strategyId: message.strategyId, params: response.data }
        : { type: "error", message: response.error ?? "Unable to fetch parameters." };
    }
    default:
      return { type: "error", message: "Unknown request" };
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return undefined;
  }
  return handleBackgroundRequest(message as BackgroundRequest);
});

