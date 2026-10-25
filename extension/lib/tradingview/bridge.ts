import { OptimiserError, type SerializedOptimiserError } from '../errors';

const REQUEST_EVENT = 'tvopt:request';
const RESPONSE_EVENT = 'tvopt:response';
const DEFAULT_TIMEOUT_MS = 5_000;

interface BridgeRequest {
  id: string;
  action: string;
  payload?: unknown;
}

interface BridgeResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: SerializedOptimiserError | string;
}

export class TradingViewBridge {
  readonly #script: HTMLScriptElement;
  readonly #pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(script: HTMLScriptElement) {
    this.#script = script;
    this.#script.addEventListener(RESPONSE_EVENT, this.#onResponse as EventListener);
  }

  request<T>(action: string, payload?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const id = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new OptimiserError(
            'TV_BRIDGE_TIMEOUT',
            'Timed out waiting for TradingView page API',
            true,
          ),
        );
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const detail: BridgeRequest = {
        id,
        action,
        ...(payload === undefined ? {} : { payload }),
      };
      this.#script.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail }));
    });
  }

  dispose(): void {
    this.#script.removeEventListener(RESPONSE_EVENT, this.#onResponse as EventListener);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new OptimiserError('TV_BRIDGE_DISPOSED', 'TradingView bridge disposed', true));
    }
    this.#pending.clear();
  }

  readonly #onResponse = (event: CustomEvent<BridgeResponse>): void => {
    const response = event.detail;
    if (!response || typeof response.id !== 'string') return;

    const pending = this.#pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.#pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    if (response.error && typeof response.error === 'object') {
      pending.reject(
        new OptimiserError(response.error.code, response.error.message, response.error.retryable),
      );
      return;
    }

    pending.reject(
      new OptimiserError(
        'TV_BRIDGE_REQUEST_FAILED',
        response.error ?? 'TradingView page API request failed',
      ),
    );
  };
}
