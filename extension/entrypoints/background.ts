import { BackendClient } from '../lib/backend-client';
import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../lib/messages';
import type { NextTrial, RunProgress } from '../lib/protocol/types';

const RUN_OWNERS_KEY = 'runOwners';

export default defineBackground(() => {
  const backend = new BackendClient();
  const runOwners = new Map<string, number>();

  let backendState: BackendState = backend.state;

  const persistRunOwners = async () => {
    await browser.storage.local.set({
      [RUN_OWNERS_KEY]: Object.fromEntries(runOwners),
    });
  };

  const loadRunOwners = async () => {
    const stored = await browser.storage.local.get(RUN_OWNERS_KEY);
    const owners = stored[RUN_OWNERS_KEY];

    if (!owners || typeof owners !== 'object') return;

    for (const [runId, tabId] of Object.entries(
      owners as Record<string, unknown>,
    )) {
      if (typeof tabId === 'number') {
        runOwners.set(runId, tabId);
      }
    }
  };

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
          pairingRequired: event.pairingRequired ?? false,
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

      const handle = async () => {
        switch (msg.type) {
          case 'GET_BACKEND_STATE':
            return backend.state;

          case 'BACKEND_CONNECT':
            await backend.connect();
            return backend.state;

          case 'PAIR_BACKEND':
            await backend.pair(msg.payload.code);
            return backend.state;

          case 'CREATE_RUN':
            if (sender.tab?.id !== undefined) {
              runOwners.set(msg.payload.run_id, sender.tab.id);
              await persistRunOwners();
            }
            await backend.createRun(msg.payload);
            return { ok: true };

          case 'REGISTER_RUN_OWNER':
            if (sender.tab?.id !== undefined) {
              runOwners.set(msg.payload.runId, sender.tab.id);
              await persistRunOwners();
            }
            return { ok: true };

          case 'CLEAR_RUN_OWNER':
            runOwners.delete(msg.payload.runId);
            await persistRunOwners();
            return { ok: true };

          case 'START_RUN':
            await backend.startRun(msg.payload.runId);
            return { ok: true };

          case 'STOP_RUN':
            await backend.stopRun(msg.payload.runId);
            return { ok: true };

          case 'GET_RUN_ANALYSIS':
            return backend.getRunAnalysis(
              msg.payload.runId,
              msg.payload.config,
            );

          case 'TRIAL_RESULT':
            await backend.submitTrialResult(msg.payload);
            return { ok: true };

          case 'TRIAL_FAILED':
            await backend.submitTrialFailure(
              msg.payload.runId,
              msg.payload.trialNumber,
              msg.payload.reason,
            );
            return { ok: true };

          case 'EXPORT_RESULTS': {
            const url =
              'data:' +
              msg.payload.mimeType +
              ';charset=utf-8,' +
              encodeURIComponent(msg.payload.content);

            const downloadId = await browser.downloads.download({
              url,
              filename: msg.payload.filename,
              saveAs: true,
            });
            return { ok: true, downloadId };
          }
        }
      };

      void handle()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    },
  );

  void loadRunOwners();
  void backend.connect();
});
