import { BackendClient } from '../lib/backend-client';
import type { BackgroundMessage } from '../lib/messages';

export default defineBackground(() => {
  const backend = new BackendClient();

  backend.subscribe((event) => {
    let message: BackgroundMessage;
    switch (event.type) {
      case 'connection':
        message = {
          type: 'BACKEND_STATE',
          connected: event.connected,
          ...(event.optunaVersion ? { optunaVersion: event.optunaVersion } : {}),
        };
        break;
      case 'progress':
        message = { type: 'RUN_PROGRESS', progress: event.progress };
        break;
      case 'trial':
        message = { type: 'NEXT_TRIAL', trial: event.trial };
        break;
      case 'error':
        message = { type: 'BACKEND_ERROR', message: event.message };
        break;
    }
    void browser.tabs.query({ url: ['https://*.tradingview.com/*'] }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
      }
    });
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return;
    await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_UI' } satisfies BackgroundMessage);
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; payload?: unknown };
    switch (msg.type) {
      case 'BACKEND_CONNECT':
        void backend.connect();
        break;
      case 'CREATE_RUN':
        backend.createRun(msg.payload as never);
        break;
      case 'START_RUN':
        backend.startRun((msg.payload as { runId: string }).runId);
        break;
      case 'STOP_RUN':
        backend.stopRun((msg.payload as { runId: string }).runId);
        break;
      case 'TRIAL_RESULT':
        backend.submitTrialResult(msg.payload as never);
        break;
      case 'TRIAL_FAILED': {
        const payload = msg.payload as { runId: string; trialNumber: number; reason: string };
        backend.submitTrialFailure(payload.runId, payload.trialNumber, payload.reason);
        break;
      }
    }
  });

  void backend.connect();
});
