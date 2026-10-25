import { OptimiserError, type SerializedOptimiserError } from './errors';
import type { BackendState } from './messages';
import type { BackendCommand, Envelope, NextTrial, RunProgress, RunUpdate } from './protocol/types';

type BackendEvent =
  | ({ type: 'connection' } & BackendState)
  | { type: 'progress'; progress: RunProgress }
  | { type: 'update'; update: RunUpdate }
  | { type: 'trial'; trial: NextTrial }
  | { type: 'error'; message: string };

type Listener = (event: BackendEvent) => void;

interface PendingRequest {
  resolve: (message: Envelope) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const PROTOCOL_VERSION = 2;
const BACKEND_WS_URL = 'ws://127.0.0.1:8765/ws';
const BACKEND_HTTP_URL = 'http://127.0.0.1:8765';
const HEARTBEAT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class BackendClient {
  #socket: WebSocket | null = null;
  #connecting: Promise<void> | null = null;
  readonly #listeners = new Set<Listener>();
  readonly #pendingRequests = new Map<string, PendingRequest>();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  #manualClose = false;
  #authenticated = false;
  #pairingRequired = false;
  #backendVersion: string | undefined;
  #optunaVersion: string | undefined;

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): BackendState {
    return {
      connected: this.#authenticated,
      ...(this.#backendVersion ? { backendVersion: this.#backendVersion } : {}),
      ...(this.#optunaVersion ? { optunaVersion: this.#optunaVersion } : {}),
      pairingRequired: this.#pairingRequired,
    };
  }

  connect(): Promise<void> {
    if (this.#connecting !== null) return this.#connecting;

    if (
      this.#socket?.readyState === WebSocket.OPEN ||
      this.#socket?.readyState === WebSocket.CONNECTING
    ) {
      return Promise.resolve();
    }

    this.#connecting = this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  async #connect(): Promise<void> {
    this.#manualClose = false;
    this.#authenticated = false;
    this.#token = await this.#loadToken();

    if (!this.#token) {
      this.#pairingRequired = true;
      this.#emitConnection();
      return;
    }

    const socket = new WebSocket(BACKEND_WS_URL);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      socket.send(
        JSON.stringify({
          type: 'AUTH',
          request_id: crypto.randomUUID(),
          payload: { token: this.#token },
        } satisfies Envelope),
      );
    });

    socket.addEventListener('message', (event) => {
      if (this.#socket === socket) this.#handleMessage(String(event.data));
    });

    socket.addEventListener('close', (event) => {
      if (this.#socket !== socket) return;
      this.#stopHeartbeat();
      this.#authenticated = false;
      this.#socket = null;

      this.#rejectPending(
        new OptimiserError(
          'BACKEND_DISCONNECTED',
          'Backend connection closed before the request completed',
          true,
        ),
      );

      if (event.code === 1008) {
        this.#pairingRequired = true;
        this.#emitConnection();
        return;
      }

      this.#emitConnection();
      if (!this.#manualClose && !this.#pairingRequired) {
        this.#scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      if (this.#socket !== socket) return;
      this.#emit({
        type: 'error',
        message: 'Could not connect to the local optimiser service.',
      });
    });
  }

  async pair(code: string): Promise<void> {
    const response = await fetch(BACKEND_HTTP_URL + '/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      let detail = 'Pairing failed';
      try {
        const body = (await response.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // Use the default pairing error if the response body is unreadable.
      }
      throw new Error(detail);
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token || body.token.length < 16) {
      throw new Error('Backend returned an invalid pairing token');
    }

    this.#pairingRequired = false;
    await browser.storage.local.set({ backendToken: body.token });

    this.#disconnect();
    await this.connect();
  }

  #disconnect(): void {
    this.#manualClose = true;
    this.#authenticated = false;
    this.#stopHeartbeat();

    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;

    this.#rejectPending(
      new OptimiserError('BACKEND_DISCONNECTED', 'Backend client disconnected', true),
    );
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }

  request(command: BackendCommand): Promise<Envelope> {
    const { type, payload } = command;
    if (!this.#authenticated || this.#socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new OptimiserError('BACKEND_DISCONNECTED', 'Backend is not connected', true),
      );
    }

    const requestId = crypto.randomUUID();
    const envelope: Envelope = {
      type,
      request_id: requestId,
      payload,
    };

    return new Promise<Envelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(requestId);
        reject(new OptimiserError('REQUEST_TIMEOUT', 'Backend request timed out: ' + type, true));

        // A timeout leaves the request outcome unknown. Reconnect to reconcile
        // the run state before sending more requests.
        this.#socket?.close();
      }, REQUEST_TIMEOUT_MS);

      this.#pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      try {
        this.#socket!.send(JSON.stringify(envelope));
      } catch (error) {
        clearTimeout(timeout);
        this.#pendingRequests.delete(requestId);
        reject(
          new OptimiserError(
            'BACKEND_DISCONNECTED',
            error instanceof Error ? error.message : String(error),
            true,
          ),
        );
      }
    });
  }

  #sendPing(): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;

    this.#socket.send(
      JSON.stringify({
        type: 'PING',
        request_id: crypto.randomUUID(),
        payload: {},
      } satisfies Envelope),
    );
  }

  #handleMessage(raw: string): void {
    let message: Envelope;

    try {
      message = JSON.parse(raw) as Envelope;
      if (
        !message ||
        typeof message.type !== 'string' ||
        !message.payload ||
        typeof message.payload !== 'object' ||
        Array.isArray(message.payload)
      ) {
        throw new Error('Invalid backend envelope');
      }
    } catch {
      this.#emit({
        type: 'error',
        message: 'Backend returned an invalid protocol message.',
      });
      return;
    }

    if (message.request_id) {
      const pending = this.#pendingRequests.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.#pendingRequests.delete(message.request_id);

        if (message.type === 'ERROR') {
          const payload = message.payload as Partial<SerializedOptimiserError>;

          pending.reject(
            new OptimiserError(
              payload.code ?? 'BACKEND_ERROR',
              payload.message ?? 'Backend rejected the request',
              payload.retryable ?? false,
            ),
          );
        } else {
          pending.resolve(message);
        }
      }
    }

    switch (message.type) {
      case 'CONNECTED': {
        const payload = message.payload as {
          protocol_version?: number;
          backend_version?: string;
          optuna_version?: string;
        };

        if (payload.protocol_version !== PROTOCOL_VERSION) {
          this.#emit({
            type: 'error',
            message:
              'Backend protocol mismatch. Update the TradeCopy Companion and extension together.',
          });
          this.#disconnect();
          return;
        }

        this.#backendVersion = payload.backend_version;
        this.#optunaVersion = payload.optuna_version;
        this.#authenticated = true;
        this.#pairingRequired = false;
        this.#emitConnection();
        this.#startHeartbeat();
        break;
      }

      case 'RUN_PROGRESS':
        this.#emit({
          type: 'progress',
          progress: message.payload as RunProgress,
        });
        break;

      case 'RUN_UPDATE':
        this.#emit({
          type: 'update',
          update: message.payload as RunUpdate,
        });
        break;

      case 'NEXT_TRIAL':
        this.#emit({
          type: 'trial',
          trial: message.payload as NextTrial,
        });
        break;

      case 'ERROR': {
        const payload = message.payload as Partial<SerializedOptimiserError>;
        this.#emit({
          type: 'error',
          message: payload.message ?? 'Unknown backend error',
        });
        break;
      }
    }
  }

  async #loadToken(): Promise<string | null> {
    const stored = await browser.storage.local.get('backendToken');
    return typeof stored.backendToken === 'string' && stored.backendToken.length >= 16
      ? stored.backendToken
      : null;
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();

    this.#heartbeat = setInterval(() => {
      this.#sendPing();
    }, HEARTBEAT_MS);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer) return;

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.connect();
    }, 1_500);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pendingRequests.clear();
  }

  #emitConnection(): void {
    this.#emit({
      type: 'connection',
      ...this.state,
    });
  }

  #emit(event: BackendEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
