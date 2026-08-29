import type {
  CreateRun,
  Envelope,
  NextTrial,
  RunAnalysis,
  RunProgress,
  TrialResult,
} from './protocol/types';

export type BackendEvent =
  | {
      type: 'connection';
      connected: boolean;
      optunaVersion?: string;
      pairingRequired?: boolean;
    }
  | { type: 'progress'; progress: RunProgress }
  | { type: 'trial'; trial: NextTrial }
  | { type: 'error'; message: string };

type Listener = (event: BackendEvent) => void;

interface PendingRequest {
  resolve: (message: Envelope) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const BACKEND_WS_URL = 'ws://127.0.0.1:8765/ws';
const BACKEND_HTTP_URL = 'http://127.0.0.1:8765';
const HEARTBEAT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class BackendClient {
  #socket: WebSocket | null = null;
  #listeners = new Set<Listener>();
  #pendingRequests = new Map<string, PendingRequest>();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  #manualClose = false;
  #authenticated = false;
  #pairingRequired = false;
  #optunaVersion: string | undefined;

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): {
    connected: boolean;
    optunaVersion?: string;
    pairingRequired: boolean;
  } {
    return {
      connected: this.#authenticated,
      ...(this.#optunaVersion ? { optunaVersion: this.#optunaVersion } : {}),
      pairingRequired: this.#pairingRequired,
    };
  }

  async connect(): Promise<void> {
    if (
      this.#socket?.readyState === WebSocket.OPEN ||
      this.#socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.#manualClose = false;
    this.#authenticated = false;
    this.#token = await this.#loadToken();

    if (!this.#token) {
      this.#pairingRequired = true;
      this.#emitConnection(false);
      return;
    }

    const socket = new WebSocket(BACKEND_WS_URL);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'AUTH',
          request_id: crypto.randomUUID(),
          payload: { token: this.#token },
        } satisfies Envelope),
      );
    });

    socket.addEventListener('message', (event) =>
      this.#handleMessage(String(event.data)),
    );

    socket.addEventListener('close', (event) => {
      this.#stopHeartbeat();
      this.#authenticated = false;
      if (this.#socket === socket) this.#socket = null;

      this.#rejectPending(
        new Error('Backend connection closed before the request completed'),
      );

      if (event.code === 1008) {
        this.#pairingRequired = true;
        this.#emitConnection(false);
        return;
      }

      this.#emitConnection(false);
      if (!this.#manualClose && !this.#pairingRequired) {
        this.#scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
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
        // Keep generic message.
      }
      throw new Error(detail);
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token || body.token.length < 16) {
      throw new Error('Backend returned an invalid pairing token');
    }

    this.#token = body.token;
    this.#pairingRequired = false;
    await browser.storage.local.set({ backendToken: body.token });

    this.disconnect();
    this.#manualClose = false;
    await this.connect();
  }

  disconnect(): void {
    this.#manualClose = true;
    this.#authenticated = false;
    this.#stopHeartbeat();

    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;

    this.#rejectPending(new Error('Backend client disconnected'));
    this.#socket?.close();
    this.#socket = null;
  }

  async createRun(run: CreateRun): Promise<void> {
    await this.#request('CREATE_RUN', run);
  }

  async startRun(runId: string): Promise<void> {
    await this.#request('START_RUN', { run_id: runId });
  }

  async stopRun(runId: string): Promise<void> {
    await this.#request('STOP_RUN', { run_id: runId });
  }

  async getRunAnalysis(runId: string): Promise<RunAnalysis> {
    const response = await this.#request('GET_RUN_ANALYSIS', {
      run_id: runId,
    });
    return response.payload as RunAnalysis;
  }

  async submitTrialResult(result: TrialResult): Promise<void> {
    await this.#request('TRIAL_RESULT', result);
  }

  async submitTrialFailure(
    runId: string,
    trialNumber: number,
    reason: string,
  ): Promise<void> {
    await this.#request('TRIAL_FAILED', {
      run_id: runId,
      trial_number: trialNumber,
      reason,
    });
  }

  #request(type: string, payload: unknown): Promise<Envelope> {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Backend is not connected'));
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
        reject(
          new Error(
            'Backend request timed out: ' + type,
          ),
        );
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
        reject(error instanceof Error ? error : new Error(String(error)));
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
    } catch {
      this.#emit({
        type: 'error',
        message: 'Backend returned invalid JSON.',
      });
      return;
    }

    if (message.request_id) {
      const pending = this.#pendingRequests.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.#pendingRequests.delete(message.request_id);

        if (message.type === 'ERROR') {
          const payload = message.payload as { message?: string };
          pending.reject(
            new Error(payload.message ?? 'Backend rejected the request'),
          );
        } else {
          pending.resolve(message);
        }
      }
    }

    switch (message.type) {
      case 'CONNECTED': {
        const payload = message.payload as { optuna_version?: string };
        this.#optunaVersion = payload.optuna_version;
        this.#authenticated = true;
        this.#pairingRequired = false;
        this.#emitConnection(true);
        this.#startHeartbeat();
        break;
      }

      case 'RUN_PROGRESS':
        this.#emit({
          type: 'progress',
          progress: message.payload as RunProgress,
        });
        break;

      case 'NEXT_TRIAL':
        this.#emit({
          type: 'trial',
          trial: message.payload as NextTrial,
        });
        break;

      case 'ERROR': {
        const payload = message.payload as { message?: string };
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
    return typeof stored.backendToken === 'string' &&
      stored.backendToken.length >= 16
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

  #emitConnection(connected: boolean): void {
    this.#emit({
      type: 'connection',
      connected,
      ...(this.#optunaVersion
        ? { optunaVersion: this.#optunaVersion }
        : {}),
      pairingRequired: this.#pairingRequired,
    });
  }

  #emit(event: BackendEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
