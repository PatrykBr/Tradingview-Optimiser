import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendClient, sendBackendMaintenanceMessage } from './backend-client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'closed' });
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

describe('backend-client message routing', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket = OriginalWebSocket;
  });

  it('rejects maintenance responses that are not delete_ack', async () => {
    const sendPromise = sendBackendMaintenanceMessage('ws://localhost/ws/optimize', 4096, {
      type: 'delete_study',
      study_name: 'study_a',
    });

    await Promise.resolve();
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    if (!socket) return;

    const outbound = JSON.parse(socket.sent[0] ?? '{}') as { request_id?: string };
    socket.emitMessage(
      JSON.stringify({
        request_id: outbound.request_id,
        type: 'status',
        n_trials: 0,
        best_value: null,
        best_params: null,
      }),
    );

    await expect(sendPromise).rejects.toThrow('Unexpected maintenance response type: status');
  });

  it('accepts delete_ack maintenance responses matching the requested target', async () => {
    const sendPromise = sendBackendMaintenanceMessage('ws://localhost/ws/optimize', 4096, {
      type: 'delete_study_family',
      study_family: 'family_a',
    });

    await Promise.resolve();
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    if (!socket) return;

    const outbound = JSON.parse(socket.sent[0] ?? '{}') as { request_id?: string };
    socket.emitMessage(
      JSON.stringify({
        request_id: outbound.request_id,
        type: 'delete_ack',
        deleted: 'study_family',
        target: 'family_a',
      }),
    );

    await expect(sendPromise).resolves.toBeUndefined();
  });

  it('rejects maintenance command when backend error has no request_id', async () => {
    const sendPromise = sendBackendMaintenanceMessage('ws://localhost/ws/optimize', 4096, {
      type: 'delete_study',
      study_name: 'study_b',
    });

    await Promise.resolve();
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.emitMessage(
      JSON.stringify({
        type: 'error',
        message: 'delete failed',
      }),
    );

    await expect(sendPromise).rejects.toThrow('delete failed');
  });

  it('rejects pending requests when backend sends error without request_id', async () => {
    const client = new BackendClient({
      baseWsUrl: 'ws://localhost/ws/optimize',
      maxMessageBytes: 4096,
    });
    await client.connect('study_a', 1);

    const pending = client.request({ type: 'status' }, 5000);
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    if (!socket) return;

    socket.emitMessage(
      JSON.stringify({
        type: 'error',
        message: 'backend unavailable',
      }),
    );

    await expect(pending).rejects.toThrow('backend unavailable');
    client.close();
  });
});
