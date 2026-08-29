import type {
  CreateRun,
  Envelope,
  NextTrial,
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

const BACKEND_WS_URL = 'ws://127.0.0.1:8765/ws';
const BACKEND_HTTP_URL = 'http://127.0.0.1:8765';
const HEARTBEAT_MS = 20_000;

export class BackendClient {
  #socket: WebSocket | null = null;
  #listeners = new Set<Listener>();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  #manualClose = false;
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
      connected: this.#socket?.readyState === WebSocket.OPEN,
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
    this.#token = await this.#loadToken();

    if (!this.#token) {
      this.#pairingRequired = true;
      this.#emitConnection(false);
      return;
    }

    const socket = new WebSocket(
      BACKEND_WS_URL + '?token=' + encodeURIComponent(this.#token),
    );
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#pairingRequired = false;
      this.#emitConnection(true);
      this.#startHeartbeat();
    });

    socket.addEventListener('message', (event) =>
      this.#handleMessage(String(event.data)),
    );

    socket.addEventListener('close', (event) => {
      this.#stopHeartbeat();
      if (this.#socket === socket) this.#socket = null;

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
    this.#stopHeartbeat();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close();
    this.#socket = null;
  }

  createRun(run: CreateRun): void {
    this.#send('CREATE_RUN', run);
  }

  startRun(runId: string): void {
    this.#send('START_RUN', { run_id: runId });
  }

  stopRun(runId: string): void {
    this.#send('STOP_RUN', { run_id: runId });
  }

  submitTrialResult(result: TrialResult): void {
    this.#send('TRIAL_RESULT', result);
  }

  submitTrialFailure(
    runId: string,
    trialNumber: number,
    reason: string,
  ): void {
    this.#send('TRIAL_FAILED', {
      run_id: runId,
      trial_number: trialNumber,
      reason,
    });
  }

  #send(type: string, payload: unknown): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Backend is not connected');
    }

    const envelope: Envelope = {
      type,
      request_id: crypto.randomUUID(),
      payload,
    };
    this.#socket.send(JSON.stringify(envelope));
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

    switch (message.type) {
      case 'CONNECTED': {
        const payload = message.payload as { optuna_version?: string };
        this.#optunaVersion = payload.optuna_version;
        this.#pairingRequired = false;
        this.#emitConnection(true);
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
      if (this.#socket?.readyState === WebSocket.OPEN) {
        this.#send('PING', {});
      }
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
