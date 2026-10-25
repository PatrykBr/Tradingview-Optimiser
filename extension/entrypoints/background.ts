import { BackendClient } from '../lib/backend-client';
import { combineFailures, serialiseOptimiserError, toOptimiserError } from '../lib/errors';
import type { BackgroundMessage, ExtensionRequest } from '../lib/messages';
import type { NextTrial, RunProgress, RunUpdate } from '../lib/protocol/types';

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
    if (!owners || typeof owners !== 'object' || Array.isArray(owners)) {
      throw new Error('Persisted optimiser run ownership is corrupted');
    }

    for (const [runId, tabId] of Object.entries(owners as Record<string, unknown>)) {
      if (typeof tabId !== 'number') {
        throw new TypeError('Persisted optimiser run ownership is corrupted for ' + runId);
      }
      runOwners.set(runId, tabId);
    }
  };

  const sendToTab = async (tabId: number, message: BackgroundMessage): Promise<void> => {
    await browser.tabs.sendMessage(tabId, message);
  };

  const runTask = (task: Promise<unknown>, label: string): void => {
    void task.catch((cause) => {
      console.error(label, cause);
    });
  };

  const broadcast = async (message: BackgroundMessage): Promise<void> => {
    const tabs = await browser.tabs.query({
      url: ['https://*.tradingview.com/*'],
    });

    const results = await Promise.allSettled(
      tabs
        .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
        .map((tab) => sendToTab(tab.id, message)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Could not broadcast optimiser message to a TradingView tab', result.reason);
      }
    }
  };

  const clearRunOwner = async (runId: string): Promise<void> => {
    await ownersReady;
    runOwners.delete(runId);
    await persistRunOwners();
  };

  const routeRunMessage = async (
    runId: string,
    message: BackgroundMessage,
    critical = false,
  ): Promise<void> => {
    await ownersReady;
    const owner = runOwners.get(runId);

    if (owner === undefined) {
      if (critical) {
        const reason = 'No TradingView tab owns the next optimiser trial';
        try {
          await backend.request({ type: 'ABORT_RUN', payload: { run_id: runId, reason } });
        } catch (cause) {
          await broadcast({
            type: 'BACKEND_ERROR',
            message: combineFailures(
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
      await sendToTab(owner, message);
    } catch (cause) {
      try {
        await clearRunOwner(runId);
      } catch (error_) {
        console.error('Failed to clear stale optimiser run ownership', error_);
      }

      if (!critical) {
        await broadcast(message);
        return;
      }

      const deliveryError = toOptimiserError(cause, 'DELIVERY_FAILED', true);
      const reason =
        'Could not deliver the next optimiser trial to its TradingView tab: ' +
        deliveryError.message;

      try {
        await backend.request({ type: 'ABORT_RUN', payload: { run_id: runId, reason } });
      } catch (error_) {
        await broadcast({
          type: 'BACKEND_ERROR',
          message: combineFailures(
            deliveryError,
            error_,
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
        runTask(
          broadcast({
            type: 'BACKEND_STATE',
            connected: event.connected,
            ...(event.backendVersion
              ? {
                  backendVersion: event.backendVersion,
                }
              : {}),
            ...(event.optunaVersion
              ? {
                  optunaVersion: event.optunaVersion,
                }
              : {}),
            pairingRequired: event.pairingRequired ?? false,
          }),
          'Could not broadcast backend connection state',
        );
        break;

      case 'progress': {
        const progress: RunProgress = event.progress;
        runTask(
          routeRunMessage(progress.run_id, {
            type: 'RUN_PROGRESS',
            progress,
          }),
          'Could not route optimiser progress',
        );
        break;
      }

      case 'update': {
        const update: RunUpdate = event.update;
        runTask(
          routeRunMessage(update.run_id, {
            type: 'RUN_UPDATE',
            update,
          }),
          'Could not route optimiser update',
        );
        break;
      }

      case 'trial': {
        const trial: NextTrial = event.trial;
        runTask(
          routeRunMessage(
            trial.run_id,
            {
              type: 'NEXT_TRIAL',
              trial,
            },
            true,
          ),
          'Could not route optimiser trial',
        );
        break;
      }

      case 'error':
        runTask(
          broadcast({
            type: 'BACKEND_ERROR',
            message: event.message,
          }),
          'Could not broadcast backend error',
        );
        break;
    }
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    runTask(
      sendToTab(tab.id, { type: 'TOGGLE_UI' }),
      'Could not toggle optimiser UI in the selected tab',
    );
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (response?: unknown) => void) => {
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
            await ownersReady;
            await backend.request(msg);

            if (sender.tab?.id !== undefined) {
              runOwners.set(msg.payload.run_id, sender.tab.id);

              try {
                await persistRunOwners();
              } catch (cause) {
                runOwners.delete(msg.payload.run_id);

                // Stop the study if its owner metadata could not be saved.
                // Preserve its history for recovery.
                try {
                  await backend.request({
                    type: 'ABORT_RUN',
                    payload: {
                      run_id: msg.payload.run_id,
                      reason: 'Run ownership could not be persisted',
                    },
                  });
                } catch (error_) {
                  throw combineFailures(
                    cause,
                    error_,
                    'Could not persist run ownership and could not stop the unowned backend run',
                  );
                }

                throw toOptimiserError(cause, 'RUN_OWNER_PERSIST_FAILED', false);
              }
            }

            return { ok: true };
          }

          case 'CLEAR_RUN_OWNER':
            await clearRunOwner(msg.payload.runId);
            return { ok: true };

          case 'ABORT_RUN':
          case 'DELETE_RUN':
            // A user abort must reach the backend even while ownership is loading.
            if (msg.type === 'DELETE_RUN') await ownersReady;
            await backend.request(msg);
            await clearRunOwner(msg.payload.run_id);
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
          default: {
            const response = await backend.request(msg);
            return msg.type === 'GET_RUN_ANALYSIS' ? response.payload : { ok: true };
          }
        }
      };

      void handle()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: serialiseOptimiserError(error, 'BACKGROUND_REQUEST_FAILED'),
          });
        });

      return true;
    },
  );

  const ownersReady = loadRunOwners();
  void ownersReady.catch((cause) => {
    console.error('Could not restore optimiser run ownership', cause);
    runTask(
      broadcast({
        type: 'BACKEND_ERROR',
        message: 'Could not restore optimiser run ownership: ' + toOptimiserError(cause).message,
      }),
      'Could not broadcast run-owner restore failure',
    );
  });

  void backend.connect().catch((cause) => {
    console.error('Initial optimiser backend connection failed', cause);
    runTask(
      broadcast({
        type: 'BACKEND_ERROR',
        message: toOptimiserError(cause, 'BACKEND_DISCONNECTED', true).message,
      }),
      'Could not broadcast initial backend connection failure',
    );
  });
});
