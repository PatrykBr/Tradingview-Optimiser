import { BackendClient } from '../lib/backend-client';
import {
  combineFailures,
  serialiseOptimiserError,
  toOptimiserError,
} from '../lib/errors';
import type {
  BackgroundMessage,
  ExtensionRequest,
} from '../lib/messages';
import type {
  NextTrial,
  RunProgress,
  RunUpdate,
} from '../lib/protocol/types';

const RUN_OWNERS_KEY = 'runOwners';

export default defineBackground(() => {
  const backend = new BackendClient();
  const runOwners = new Map<string, number>();

  const persistRunOwners = async () => {
    await browser.storage.local.set({
      [RUN_OWNERS_KEY]: Object.fromEntries(runOwners),
    });
  };

  const loadRunOwners = async () => {
    const stored = await browser.storage.local.get(RUN_OWNERS_KEY);
    const owners = stored[RUN_OWNERS_KEY];

    if (owners === undefined) return;
    if (
      !owners ||
      typeof owners !== 'object' ||
      Array.isArray(owners)
    ) {
      throw new Error(
        'Persisted optimiser run ownership is corrupted',
      );
    }

    for (const [runId, tabId] of Object.entries(
      owners as Record<string, unknown>,
    )) {
      if (typeof tabId !== 'number') {
        throw new Error(
          'Persisted optimiser run ownership is corrupted for ' +
            runId,
        );
      }
      runOwners.set(runId, tabId);
    }
  };

  const sendToTab = async (
    tabId: number,
    message: BackgroundMessage,
  ): Promise<void> => {
    await browser.tabs.sendMessage(
      tabId,
      message,
    );
  };

  const broadcast = async (
    message: BackgroundMessage,
  ): Promise<void> => {
    const tabs = await browser.tabs.query({
      url: ['https://*.tradingview.com/*'],
    });

    await Promise.allSettled(
      tabs
        .filter(
          (tab): tab is typeof tab & { id: number } =>
            tab.id !== undefined,
        )
        .map((tab) =>
          sendToTab(tab.id, message),
        ),
    );
  };

  const clearRunOwner = async (
    runId: string,
  ): Promise<void> => {
    runOwners.delete(runId);
    await persistRunOwners();
  };

  const routeRunMessage = async (
    runId: string,
    message: BackgroundMessage,
    critical = false,
  ): Promise<void> => {
    const owner = runOwners.get(runId);

    if (owner === undefined) {
      if (critical) {
        const reason =
          'No TradingView tab owns the next optimiser trial';
        try {
          await backend.abortRun(
            runId,
            reason,
          );
        } catch (cause) {
          await broadcast({
            type: 'BACKEND_ERROR',
            message:
              combineFailures(
                new Error(reason),
                cause,
                'Could not stop an undeliverable optimisation',
              ).message,
          });
        }
        return;
      }

      await broadcast(message);
      return;
    }

    try {
      await sendToTab(
        owner,
        message,
      );
    } catch (cause) {
      try {
        await clearRunOwner(runId);
      } catch (ownerFailure) {
        console.error(
          'Failed to clear stale optimiser run ownership',
          ownerFailure,
        );
      }

      if (!critical) {
        await broadcast(message);
        return;
      }

      const deliveryError =
        toOptimiserError(
          cause,
          'DELIVERY_FAILED',
          true,
        );
      const reason =
        'Could not deliver the next optimiser trial to its TradingView tab: ' +
        deliveryError.message;

      try {
        await backend.abortRun(
          runId,
          reason,
        );
      } catch (abortFailure) {
        await broadcast({
          type: 'BACKEND_ERROR',
          message:
            combineFailures(
              deliveryError,
              abortFailure,
              'Trial delivery failed and the backend run could not be aborted',
            ).message,
        });
        return;
      }

      await broadcast({
        type: 'BACKEND_ERROR',
        message: reason,
      });
    }
  };

  backend.subscribe((event) => {
    switch (event.type) {
      case 'connection':
        void broadcast({
          type: 'BACKEND_STATE',
          connected: event.connected,
          ...(event.backendVersion
            ? {
                backendVersion:
                  event.backendVersion,
              }
            : {}),
          ...(event.optunaVersion
            ? {
                optunaVersion:
                  event.optunaVersion,
              }
            : {}),
          pairingRequired:
            event.pairingRequired ?? false,
        });
        break;

      case 'progress': {
        const progress: RunProgress = event.progress;
        void routeRunMessage(progress.run_id, {
          type: 'RUN_PROGRESS',
          progress,
        });
        break;
      }

      case 'update': {
        const update: RunUpdate = event.update;
        void routeRunMessage(update.run_id, {
          type: 'RUN_UPDATE',
          update,
        });
        break;
      }

      case 'trial': {
        const trial: NextTrial = event.trial;
        void routeRunMessage(
          trial.run_id,
          {
            type: 'NEXT_TRIAL',
            trial,
          },
          true,
        );
        break;
      }

      case 'error':
        void broadcast({ type: 'BACKEND_ERROR', message: event.message });
        break;
    }
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    try {
      await sendToTab(
        tab.id,
        { type: 'TOGGLE_UI' },
      );
    } catch (cause) {
      console.warn(
        'Could not toggle optimiser UI in the selected tab',
        cause,
      );
    }
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

          case 'CREATE_RUN': {
            await backend.createRun(
              msg.payload,
            );

            if (sender.tab?.id !== undefined) {
              runOwners.set(
                msg.payload.run_id,
                sender.tab.id,
              );

              try {
                await persistRunOwners();
              } catch (cause) {
                runOwners.delete(
                  msg.payload.run_id,
                );

                // CREATE_RUN is idempotent and may have reopened an existing
                // study. Never delete durable optimisation history just because
                // extension owner metadata could not be persisted.
                throw toOptimiserError(
                  cause,
                  'RUN_OWNER_PERSIST_FAILED',
                  true,
                );
              }
            }

            return { ok: true };
          }

          case 'CLEAR_RUN_OWNER':
            await clearRunOwner(
              msg.payload.runId,
            );
            return { ok: true };

          case 'START_RUN':
            await backend.startRun(msg.payload.runId);
            return { ok: true };

          case 'STOP_RUN':
            await backend.stopRun(msg.payload.runId);
            return { ok: true };

          case 'ABORT_RUN':
            await backend.abortRun(
              msg.payload.runId,
              msg.payload.reason ??
                'Optimisation aborted by the browser',
            );
            await clearRunOwner(
              msg.payload.runId,
            );
            return { ok: true };

          case 'DELETE_RUN':
            await backend.deleteRun(msg.payload.runId);
            runOwners.delete(msg.payload.runId);
            await persistRunOwners();
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
            error:
              serialiseOptimiserError(
                error,
                'BACKGROUND_REQUEST_FAILED',
              ),
          });
        });

      return true;
    },
  );

  void loadRunOwners().catch(
    (cause) => {
      console.error(
        'Could not restore optimiser run ownership',
        cause,
      );
      void broadcast({
        type: 'BACKEND_ERROR',
        message:
          'Could not restore optimiser run ownership: ' +
          toOptimiserError(cause).message,
      });
    },
  );

  void backend.connect().catch(
    (cause) => {
      console.error(
        'Initial optimiser backend connection failed',
        cause,
      );
      void broadcast({
        type: 'BACKEND_ERROR',
        message:
          toOptimiserError(
            cause,
            'BACKEND_DISCONNECTED',
            true,
          ).message,
      });
    },
  );
});
