import type { BackendIncomingMessage, BackendOutgoingMessage } from '../shared/messages';
import type { BackendStatus } from '../shared/types';
import { parseBackendIncomingMessage } from './protocol';

type StripRequestId<T> = T extends { request_id: string } ? Omit<T, 'request_id'> : never;
type RequestPayload = StripRequestId<BackendOutgoingMessage>;
type MaintenancePayload = Extract<RequestPayload, { type: 'delete_study' | 'delete_study_family' }>;

interface PendingRequest {
  resolve: (value: BackendIncomingMessage) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BackendClientOptions {
  baseWsUrl: string;
  maxMessageBytes: number;
  onStatusChange?: (status: BackendStatus) => void;
  onDebug?: (...args: unknown[]) => void;
}

function createRequestId(prefix: string, counter: number): string {
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export class BackendClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private readonly baseWsUrl: string;
  private readonly maxMessageBytes: number;
  private readonly onStatusChange?: (status: BackendStatus) => void;
  private readonly onDebug?: (...args: unknown[]) => void;

  constructor(options: BackendClientOptions) {
    this.baseWsUrl = options.baseWsUrl;
    this.maxMessageBytes = options.maxMessageBytes;
    this.onStatusChange = options.onStatusChange;
    this.onDebug = options.onDebug;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private setStatus(status: BackendStatus) {
    this.onStatusChange?.(status);
  }

  private debug(...args: unknown[]) {
    this.onDebug?.(...args);
  }

  private nextRequestId(prefix: string): string {
    this.sequence += 1;
    return createRequestId(prefix, this.sequence);
  }

  private rejectPending(reason: Error) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.pending.delete(requestId);
    }
  }

  private attachSocket(socket: WebSocket) {
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: BackendIncomingMessage;
      try {
        parsed = parseBackendIncomingMessage(event.data, this.maxMessageBytes);
      } catch {
        return;
      }
      if (parsed.type === 'error' && !parsed.request_id) {
        this.setStatus('error');
        this.rejectPending(new Error(parsed.message));
        return;
      }
      if (!parsed.request_id) {
        return;
      }
      const pending = this.pending.get(parsed.request_id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(parsed.request_id);
      pending.resolve(parsed);
    };

    socket.onclose = (event) => {
      this.debug(`[BackendClient] WebSocket closed (code=${event.code}, reason=${event.reason})`);
      if (this.ws === socket) {
        this.ws = null;
        this.setStatus('disconnected');
      }
      this.rejectPending(new Error('WebSocket closed'));
    };

    socket.onerror = () => {
      this.setStatus('error');
    };
  }

  async connect(studyName: string, maxRetries = 3): Promise<void> {
    const url = `${this.baseWsUrl}/${encodeURIComponent(studyName)}`;

    if (this.isConnected()) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is already connecting');
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const socket = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(url);
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              ws.close();
            } catch {
              // Ignore close errors during timeout.
            }
            reject(new Error('WebSocket connection timed out'));
          }, 10000);

          ws.onopen = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(ws);
          };

          ws.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('WebSocket connection failed'));
          };
        });

        this.ws = socket;
        this.attachSocket(socket);
        this.setStatus('connected');
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('WebSocket connect error');
        this.setStatus('error');
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Failed to connect backend WebSocket');
  }

  sendFireAndForget(message: RequestPayload): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const requestId = this.nextRequestId(message.type);
    const payload: BackendOutgoingMessage = {
      ...message,
      request_id: requestId,
    } as BackendOutgoingMessage;
    this.ws.send(JSON.stringify(payload));
    return requestId;
  }

  request(message: RequestPayload, timeout = 30000): Promise<BackendIncomingMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const requestId = this.nextRequestId(message.type);
    const payload: BackendOutgoingMessage = {
      ...message,
      request_id: requestId,
    } as BackendOutgoingMessage;

    return new Promise<BackendIncomingMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Backend response timeout (${timeout}ms)`));
      }, timeout);

      this.pending.set(requestId, { resolve, reject, timer });

      try {
        this.ws?.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err instanceof Error ? err : new Error('Failed sending backend message'));
      }
    });
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors on teardown.
      }
    }
    this.ws = null;
    this.rejectPending(new Error('WebSocket closed'));
  }
}

export async function sendBackendMaintenanceMessage(
  baseWsUrl: string,
  maxMessageBytes: number,
  message: MaintenancePayload,
): Promise<void> {
  const routeStudy = message.type === 'delete_study' ? message.study_name : message.study_family;
  const url = `${baseWsUrl}/${encodeURIComponent(routeStudy)}`;
  const requestId = createRequestId(message.type, Date.now());
  const payload: BackendOutgoingMessage = {
    ...message,
    request_id: requestId,
  } as BackendOutgoingMessage;

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        // Ignore close errors during cleanup.
      }
      resolve();
    };

    const finishReject = (reason: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        // Ignore close errors during cleanup.
      }
      reject(reason);
    };

    timer = setTimeout(() => {
      finishReject(new Error(`Maintenance command timeout for ${message.type}`));
    }, 12000);

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(payload));
      } catch (err) {
        finishReject(err instanceof Error ? err : new Error('Failed to send maintenance backend message'));
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        finishReject(new Error('Maintenance response must be text'));
        return;
      }
      let parsed: BackendIncomingMessage;
      try {
        parsed = parseBackendIncomingMessage(event.data, maxMessageBytes);
      } catch {
        finishReject(new Error('Invalid maintenance response from backend'));
        return;
      }

      if (parsed.type === 'error' && !parsed.request_id) {
        finishReject(new Error(parsed.message));
        return;
      }
      if (parsed.request_id !== requestId) {
        return;
      }
      if (parsed.type === 'error') {
        finishReject(new Error(parsed.message));
        return;
      }
      if (parsed.type !== 'delete_ack') {
        finishReject(new Error(`Unexpected maintenance response type: ${parsed.type}`));
        return;
      }
      const expectedDeleted = message.type === 'delete_study' ? 'study' : 'study_family';
      const expectedTarget = message.type === 'delete_study' ? message.study_name : message.study_family;
      if (parsed.deleted !== expectedDeleted || parsed.target !== expectedTarget) {
        finishReject(new Error('Maintenance ack did not match requested operation'));
        return;
      }
      finishResolve();
    };

    socket.onerror = () => {
      finishReject(new Error('Maintenance socket error'));
    };

    socket.onclose = () => {
      if (!settled) {
        finishReject(new Error('Maintenance socket closed unexpectedly'));
      }
    };
  });
}
