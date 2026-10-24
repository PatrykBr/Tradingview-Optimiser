import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../lib/backend-client';

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: Array<{ type: string; request_id: string }> = [];

  constructor() {
    super();
    FakeSocket.instances.push(this);
  }

  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 2; }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  message(type: string, payload: unknown, request_id?: string) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type, payload, request_id }),
    }));
  }
  authenticate() {
    this.open();
    this.message('CONNECTED', { protocol_version: 2 });
  }
}

describe('backend connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('browser', { storage: { local: {
      get: vi.fn(async () => ({ backendToken: 'existing-token-123456789' })),
      set: vi.fn(async () => {}),
    } } });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares concurrent connection attempts while loading the token', async () => {
    const client = new BackendClient();
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(browser.storage.local.get).toHaveBeenCalledTimes(1);
  });

  it('requires authentication before sending run commands', async () => {
    const client = new BackendClient();
    await client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await expect(client.startRun('run-1234')).rejects.toMatchObject({ code: 'BACKEND_DISCONNECTED' });
    expect(socket.sent.map((message) => message.type)).toEqual(['AUTH']);
  });

  it('ignores late events from the socket replaced by pairing', async () => {
    const client = new BackendClient();
    await client.connect();
    const previous = FakeSocket.instances[0]!;
    previous.authenticate();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'replacement-token-123456789' }),
    })));
    await client.pair('ABCD1234');
    const current = FakeSocket.instances[1]!;
    current.authenticate();
    const pending = client.startRun('run-1234');
    const requestId = current.sent.at(-1)!.request_id;

    previous.dispatchEvent(Object.assign(new Event('close'), { code: 1008 }));
    previous.message('ERROR', { message: 'stale response' }, requestId);
    expect(client.state).toMatchObject({ connected: true, pairingRequired: false });

    current.message('RUN_PROGRESS', {}, requestId);
    await expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(current.sent.at(-1)!.type).toBe('PING');
  });

  it('reports invalid envelopes without crashing its message listener', async () => {
    const client = new BackendClient();
    const events: unknown[] = [];
    client.subscribe((event) => events.push(event));
    await client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.authenticate();
    for (const data of ['null', '[]', '{', '{"type":"RUN_UPDATE","payload":null}']) {
      socket.dispatchEvent(new MessageEvent('message', { data }));
    }
    expect(events.filter((event) => (event as { type: string }).type === 'error')).toHaveLength(4);
  });
});
