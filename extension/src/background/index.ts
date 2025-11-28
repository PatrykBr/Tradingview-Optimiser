import browser from "webextension-polyfill";
import type {
  ApplyParamsPayload,
  BackgroundRequest,
  BackgroundResponse,
  ContentScriptAction,
  ContentScriptRequest,
  ContentScriptResponse,
  DateRangePayload,
  ExtensionEvent,
  GetParamsPayload,
  OptimisationConfig,
  OptimisationFilter,
  OptimisationSessionSnapshot,
  ReadMetricsPayload,
  RunStatus,
  StrategyMetric,
  StrategyParameter,
  StrategySummary,
  TrialBroadcast,
  TrialMetrics,
  TrialResult,
} from "@shared/ipc";
import { METRIC_TO_PROPERTY } from "@shared/metrics";
import { broadcastToTrial } from "@shared/trials";

const CHANNEL = "tv-optimiser";
const BACKEND_HTTP_BASE = "http://localhost:8000";
const BACKEND_WS_URL = BACKEND_HTTP_BASE.replace(/^http/, "ws") + "/optimise";
const MAX_TRIAL_HISTORY = 200;

interface SessionState {
  status: RunStatus;
  statusMessage?: string;
  config?: OptimisationConfig;
  totalTrials: number;
  completedTrials: TrialResult[];
  bestTrial: TrialResult | null;
}

const sessionState: SessionState = {
  status: "idle",
  totalTrials: 0,
  completedTrials: [],
  bestTrial: null,
};

function resetSession(config: OptimisationConfig) {
  sessionState.status = "running";
  sessionState.statusMessage = "Optimisation session started";
  sessionState.totalTrials = config.settings.trials;
  sessionState.completedTrials = [];
  sessionState.bestTrial = null;
  sessionState.config = structuredClone(config);
}

function setSessionStatus(status: RunStatus, message?: string) {
  sessionState.status = status;
  sessionState.statusMessage = message;
  if (status === "idle") {
    sessionState.config = undefined;
  }
}

function recordTrial(trial: TrialResult, best: TrialResult | null, totalTrials?: number) {
  sessionState.completedTrials = [trial, ...sessionState.completedTrials].slice(0, MAX_TRIAL_HISTORY);
  if (best) sessionState.bestTrial = best;
  if (totalTrials) sessionState.totalTrials = totalTrials;
}

function getSessionSnapshot(): OptimisationSessionSnapshot {
  return {
    status: sessionState.status,
    statusMessage: sessionState.statusMessage,
    config: sessionState.config ? structuredClone(sessionState.config) : undefined,
    totalTrials: sessionState.totalTrials,
    completedTrials: [...sessionState.completedTrials],
    bestTrial: sessionState.bestTrial,
  };
}

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
  action: ContentScriptAction,
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

function broadcast(event: ExtensionEvent) {
  browser.runtime.sendMessage(event).catch(() => undefined);
}

function emitStatus(status: RunStatus, message?: string) {
  setSessionStatus(status, message);
  broadcast({ type: "status", status, message });
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
    case "start-optimisation":
      return backendBridge.start(message.payload);
    case "stop-optimisation":
      await backendBridge.stop();
      return { type: "optimisation-stopped" };
    case "get-session":
      return { type: "session", snapshot: getSessionSnapshot() };
    case "apply-best-params":
      return applyBestParameters();
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

function extractMetricValue(metrics: TrialMetrics, metric: StrategyMetric): number | undefined {
  const key = METRIC_TO_PROPERTY[metric];
  return typeof metrics[key] === "number" ? metrics[key] : undefined;
}

function filtersPass(metrics: TrialMetrics, filters: OptimisationFilter[]): boolean {
  return filters.every((flt) => {
    const value = extractMetricValue(metrics, flt.metric);
    if (value === undefined) return false;
    switch (flt.comparator) {
      case ">=":
        return value >= flt.value;
      case "<=":
        return value <= flt.value;
      case ">":
        return value > flt.value;
      case "<":
        return value < flt.value;
      case "=":
        return value === flt.value;
    }
  });
}

class BackendBridge {
  private socket?: WebSocket;
  private config?: OptimisationConfig;

  async start(config: OptimisationConfig): Promise<BackgroundResponse> {
    await this.stop();
    this.config = config;

    return new Promise<BackgroundResponse>((resolve) => {
      try {
        this.socket = new WebSocket(BACKEND_WS_URL);
        let hasOpened = false;
        let hasResolved = false;
        const resolveOnce = (payload: BackgroundResponse) => {
          if (!hasResolved) {
            hasResolved = true;
            resolve(payload);
          }
        };

        this.socket.onopen = () => {
          if (!this.socket) return;
          hasOpened = true;
          resetSession(config);
          this.socket.send(JSON.stringify({ type: "start", config }));
          emitStatus("running", "Connected to optimiser backend");
          resolveOnce({ type: "optimisation-started" });
        };

        this.socket.onerror = (event) => {
          console.error("Backend websocket error", event);
          const message = "Unable to reach optimiser backend. Start the FastAPI server and try again.";
          if (!hasOpened) {
            emitStatus("error", message);
            resolveOnce({ type: "error", message });
            this.closeSocket();
          } else {
            emitStatus("error", "Backend connection error");
          }
        };

        this.socket.onclose = () => {
          if (hasOpened) {
            emitStatus("stopped", "Backend connection closed");
          }
          this.closeSocket();
        };

        this.socket.onmessage = (event) => {
          const payload = JSON.parse(event.data as string);
          void this.handleBackendMessage(payload);
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open optimiser backend connection";
        emitStatus("error", message);
        resolve({ type: "error", message });
      }
    });
  }

  async stop(): Promise<void> {
    const isOpen = this.socket?.readyState === WebSocket.OPEN;
    if (isOpen) {
      this.socket!.send(JSON.stringify({ type: "stop" }));
    }
    this.closeSocket();
    if (isOpen) {
      emitStatus("stopped", "Optimisation stopped");
    }
  }

  private closeSocket() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = undefined;
    this.config = undefined;
  }

  private async handleBackendMessage(message: any) {
    switch (message.type) {
      case "status":
        emitStatus("running", message.message);
        break;
      case "trial-request":
        await this.handleTrialRequest(message);
        break;
      case "trial-complete":
        this.forwardTrial(message);
        break;
      case "complete": {
        const best = formatBest(message.best);
        if (best) sessionState.bestTrial = best;
        const isFinished = message.reason === "finished";
        broadcast({ type: "complete", reason: message.reason, best });
        emitStatus(
          isFinished ? "completed" : "stopped",
          isFinished ? "Optimisation completed" : "Optimisation stopped",
        );
        break;
      }
      case "error":
        emitStatus("error", message.message);
        break;
      default:
        console.warn("Unknown backend event", message);
    }
  }

  private async handleTrialRequest(message: { trial: number; params: Record<string, number | string | boolean> }) {
    if (!this.config) return;

    const applyResponse = await sendToContent<unknown, ApplyParamsPayload>("apply-params", {
      strategyId: this.config.strategyId,
      params: message.params,
    });
    if (!applyResponse.ok) {
      emitStatus("error", applyResponse.error ?? "Failed to apply params");
      return;
    }

    const { settings } = this.config;
    if (settings.useCustomRange && settings.startDate && settings.endDate) {
      await sendToContent<unknown, DateRangePayload>("set-date-range", {
        start: settings.startDate,
        end: settings.endDate,
      });
    }

    const metricsNeeded = new Set<StrategyMetric>([settings.metric, ...settings.filters.map((f) => f.metric)]);
    const metricsResponse = await sendToContent<TrialMetrics, ReadMetricsPayload>("read-metrics", {
      metrics: Array.from(metricsNeeded),
    });
    if (!metricsResponse.ok) {
      emitStatus("error", metricsResponse.error ?? "Failed to fetch metrics");
      return;
    }

    this.socket?.send(
      JSON.stringify({
        type: "trial-result",
        trial: message.trial,
        payload: {
          metrics: metricsResponse.data,
          passedFilters: filtersPass(metricsResponse.data, settings.filters),
        },
      }),
    );
  }

  private forwardTrial(message: any) {
    const event: TrialBroadcast = {
      trial: message.trial,
      params: message.params,
      metrics: message.metrics,
      passedFilters: message.passedFilters,
      filterReasons: message.filterReasons,
      objective: message.objective,
      progress: message.progress,
      best: formatBest(message.best),
    };
    recordTrial(broadcastToTrial(event), event.best ?? null, event.progress?.total);
    broadcast({ type: "trial", payload: event });
  }
}

const backendBridge = new BackendBridge();

function formatBest(best: any): TrialResult | null {
  if (!best) return null;
  return {
    id: `best-${best.trial}-${Date.now()}`,
    trial: best.trial,
    params: best.params,
    metrics: best.metrics,
    passedFilters: true,
    timestamp: new Date().toISOString(),
  };
}

async function applyBestParameters(): Promise<BackgroundResponse> {
  const { config, bestTrial } = sessionState;
  if (!config || !bestTrial) {
    return { type: "error", message: "No optimisation results are available to apply yet." };
  }

  const response = await sendToContent<unknown, ApplyParamsPayload>("apply-params", {
    strategyId: config.strategyId,
    params: bestTrial.params,
  });

  if (!response.ok) {
    return { type: "error", message: response.error ?? "Unable to apply the best parameters to TradingView." };
  }

  emitStatus(sessionState.status, "Best parameters applied to your chart");
  return { type: "best-applied" };
}
