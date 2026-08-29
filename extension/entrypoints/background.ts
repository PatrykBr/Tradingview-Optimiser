import { BackendClient } from '../lib/backend-client';
import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../lib/messages';
import type { NextTrial, RunProgress } from '../lib/protocol/types';

export default defineBackground(() => {
  const backend = new BackendClient();
  const runOwners = new Map<string, number>();

  let backendState: BackendState = { connected: false };

  const sendToTab = (tabId: number, message: BackgroundMessage) =>
    browser.tabs.sendMessage(tabId, message).catch(() => undefined);

  const broadcast = (message: BackgroundMessage) => {
    void browser.tabs
      .query({ url: ['https://*.tradingview.com/*'] })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id !== undefined) void sendToTab(tab.id, message);
        }
      });
  };

  const routeRunMessage = (
    runId: string,
    message: BackgroundMessage,
  ) => {
    const owner = runOwners.get(runId);
    if (owner !== undefined) {
      void sendToTab(owner, message);
      return;
    }
    broadcast(message);
  };

  backend.subscribe((event) => {
    switch (event.type) {
      case 'connection': {
        backendState = {
          connected: event.connected,
          ...(event.optunaVersion
            ? { optunaVersion: event.optunaVersion }
            : backendState.optunaVersion
              ? { optunaVersion: backendState.optunaVersion }
              : {}),
        };
        broadcast({ type: 'BACKEND_STATE', ...backendState });
        break;
      }

      case 'progress': {
        const progress: RunProgress = event.progress;
        routeRunMessage(progress.run_id, {
          type: 'RUN_PROGRESS',
          progress,
        });
        break;
      }

      case 'trial': {
        const trial: NextTrial = event.trial;
        routeRunMessage(trial.run_id, {
          type: 'NEXT_TRIAL',
          trial,
        });
        break;
      }

      case 'error':
        broadcast({ type: 'BACKEND_ERROR', message: event.message });
        break;
    }
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    await sendToTab(tab.id, { type: 'TOGGLE_UI' });
  });

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as ExtensionRequest;

      try {
        switch (msg.type) {
          case 'GET_BACKEND_STATE':
            sendResponse(backendState);
            return false;

          case 'BACKEND_CONNECT':
            void backend.connect();
            sendResponse(backendState);
            return false;

          case 'CREATE_RUN':
            if (sender.tab?.id !== undefined) {
              runOwners.set(msg.payload.run_id, sender.tab.id);
            }
            backend.createRun(msg.payload);
            sendResponse({ ok: true });
            return false;

          case 'START_RUN':
            backend.startRun(msg.payload.runId);
            sendResponse({ ok: true });
            return false;

          case 'STOP_RUN':
            backend.stopRun(msg.payload.runId);
            sendResponse({ ok: true });
            return false;

          case 'TRIAL_RESULT':
            backend.submitTrialResult(msg.payload);
            sendResponse({ ok: true });
            return false;

          case 'TRIAL_FAILED':
            backend.submitTrialFailure(
              msg.payload.runId,
              msg.payload.trialNumber,
              msg.payload.reason,
            );
            sendResponse({ ok: true });
            return false;

          default:
            return false;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message });
        return false;
      }
    },
  );

  void backend.connect();
});
