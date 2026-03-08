import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceWorkerMessage } from '../../shared/messages';
import { useOptimizationStore } from './index';

class MockPort {
  readonly postedMessages: unknown[] = [];
  private readonly messageListeners: Array<(msg: ServiceWorkerMessage) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];

  readonly onMessage = {
    addListener: (listener: (msg: ServiceWorkerMessage) => void) => {
      this.messageListeners.push(listener);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
  };

  postMessage(message: unknown) {
    this.postedMessages.push(message);
  }

  disconnect() {
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }

  emitMessage(message: ServiceWorkerMessage) {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

describe('useOptimizationStore retry/state sync flow', () => {
  let port: MockPort;

  beforeEach(() => {
    port = new MockPort();

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        connect: vi.fn(() => port),
      },
      storage: {
        local: {
          get: vi.fn((_key: unknown, callback?: (result: Record<string, unknown>) => void) => {
            callback?.({});
          }),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    };

    useOptimizationStore.setState({
      backendStatus: 'disconnected',
      port: null,
      status: 'idle',
      currentTrial: 0,
      trials: [],
      historyTrials: [],
      historyRuns: [],
      resumeAvailable: false,
      bestTrial: null,
      error: null,
      startTime: null,
      applyParamsStatus: 'idle',
      applyParamsError: null,
    });
  });

  afterEach(() => {
    try {
      useOptimizationStore.getState().disconnect();
    } catch {
      // Ignore cleanup failures during tests.
    }
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('does not drop STATE_UPDATE after retryBackend', () => {
    const store = useOptimizationStore.getState();
    store.init();
    store.retryBackend();

    port.emitMessage({
      type: 'STATE_UPDATE',
      state: {
        status: 'running',
        config: null,
        currentTrial: 3,
        trials: [],
        historyTrials: [],
        historyRuns: [],
        resumeAvailable: false,
        bestTrial: null,
        error: null,
        startTime: 1234,
        pausedAt: null,
      },
    });

    const next = useOptimizationStore.getState();
    expect(next.status).toBe('running');
    expect(next.currentTrial).toBe(3);
    expect(next.startTime).toBe(1234);
  });
});
