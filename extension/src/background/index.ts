import browser from "webextension-polyfill";
import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentScriptRequest,
  ContentScriptResponse,
  ExtensionEvent,
  GetParamsPayload,
  OptimisationConfig,
  RunStatus,
  StrategyParameter,
  StrategySummary,
  TrialResult,
} from "@shared/ipc";

const CHANNEL = "tv-optimiser";
const BACKEND_WS_URL = "ws://localhost:8000/optimise";

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

function broadcast(event: ExtensionEvent) {
  browser.runtime.sendMessage(event).catch(() => undefined);
}

function emitStatus(status: RunStatus, message?: string) {
  setSessionStatus(status, message);
  broadcast({ type: "status", status, message });
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

class BackendBridge {
  private socket?: WebSocket;

  async start(config: OptimisationConfig): Promise<BackgroundResponse> {
    await this.stop();
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
          hasOpened = true;
          resetSession(config);
          this.socket!.send(JSON.stringify({ type: "start", config }));
          emitStatus("running", "Connected to optimiser backend");
          resolveOnce({ type: "optimisation-started" });
        };

        this.socket.onerror = () => {
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
  }

  private async handleBackendMessage(message: any) {
    switch (message.type) {
      case "status":
        emitStatus("running", message.message);
        break;
      case "trial-request":
        // Trial request will be handled by content script
        break;
      case "trial-complete":
        const trial: TrialResult = {
          id: `trial-${message.trial}-${Date.now()}`,
          trial: message.trial,
          params: message.params,
          metrics: message.metrics,
          passedFilters: message.passedFilters,
          timestamp: new Date().toISOString(),
        };
        sessionState.completedTrials = [trial, ...sessionState.completedTrials].slice(0, 200);
        if (message.best) {
          sessionState.bestTrial = {
            id: `best-${message.best.trial}-${Date.now()}`,
            trial: message.best.trial,
            params: message.best.params,
            metrics: message.best.metrics,
            passedFilters: true,
            timestamp: new Date().toISOString(),
          };
        }
        broadcast({
          type: "trial",
          payload: {
            trial: message.trial,
            params: message.params,
            metrics: message.metrics,
            passedFilters: message.passedFilters,
            progress: message.progress,
          },
        });
        break;
      case "complete": {
        const isFinished = message.reason === "finished";
        broadcast({ type: "complete", reason: message.reason });
        emitStatus(
          isFinished ? "completed" : "stopped",
          isFinished ? "Optimisation completed" : "Optimisation stopped",
        );
        break;
      }
      case "error":
        emitStatus("error", message.message);
        break;
    }
  }
}

const backendBridge = new BackendBridge();

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
      return {
        type: "session",
        snapshot: {
          status: sessionState.status,
          totalTrials: sessionState.totalTrials,
          completedTrials: [...sessionState.completedTrials],
        },
      };
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

