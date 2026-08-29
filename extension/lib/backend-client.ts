import type { CreateRun, Envelope, NextTrial, RunProgress, TrialResult } from './protocol/types';

export type BackendEvent =
  | { type: 'connection'; connected: boolean; optunaVersion?: string }
  | { type: 'progress'; progress: RunProgress }
  | { type: 'trial'; trial: NextTrial }
  | { type: 'error'; message: string };

type Listener = (event: BackendEvent) => void;

const BACKEND_URL = 'ws://127.0.0.1:8765/ws';
const HEARTBEAT_MS = 20_000;

export class BackendClient {
  #socket: WebSocket | null = null;
  #listeners = new Set<Listener>();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  #manualClose = false;

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.#socket?.readyState === WebSocket.OPEN || this.#socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.#manualClose = false;
    this.#token = await this.#loadToken();
    const socket = new WebSocket(BACKEND_URL + '?token=' + encodeURIComponent(this.#token));
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#emit({ type: 'connection', connected: true });
      this.#startHeartbeat();
    });
    socket.addEventListener('message', (event) => this.#handleMessage(String(event.data)));
    socket.addEventListener('close', () => {
      this.#stopHeartbeat();
      this.#emit({ type: 'connection', connected: false });
      if (!this.#manualClose) this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.#emit({ type: 'error', message: 'Could not connect to the local optimiser service.' });
    });
  }

  disconnect(): void {
    this.#manualClose = true;
    this.#stopHeartbeat();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
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

  submitTrialFailure(runId: string, trialNumber: number, reason: string): void {
    this.#send('TRIAL_FAILED', { run_id: runId, trial_number: trialNumber, reason });
  }

  #send(type: string, payload: unknown): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Backend is not connected');
    }
    const envelope: Envelope = { type, request_id: crypto.randomUUID(), payload };
    this.#socket.send(JSON.stringify(envelope));
  }

  #handleMessage(raw: string): void {
    let message: Envelope;
    try {
      message = JSON.parse(raw) as Envelope;
    } catch {
      this.#emit({ type: 'error', message: 'Backend returned invalid JSON.' });
      return;
    }

    switch (message.type) {
      case 'CONNECTED': {
        const payload = message.payload as { optuna_version?: string };
        this.#emit({ type: 'connection', connected: true, optunaVersion: payload.optuna_version });
        break;
      }
      case 'RUN_PROGRESS':
        this.#emit({ type: 'progress', progress: message.payload as RunProgress });
        break;
      case 'NEXT_TRIAL':
        this.#emit({ type: 'trial', trial: message.payload as NextTrial });
        break;
      case 'ERROR': {
        const payload = message.payload as { message?: string };
        this.#emit({ type: 'error', message: payload.message ?? 'Unknown backend error' });
        break;
      }
    }
  }

  async #loadToken(): Promise<string> {
    const stored = await browser.storage.local.get('backendToken');
    if (typeof stored.backendToken === 'string' && stored.backendToken.length >= 16) {
      return stored.backendToken;
    }
    const token = 'development-only-change-me';
    await browser.storage.local.set({ backendToken: token });
    return token;
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

  #emit(event: BackendEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
