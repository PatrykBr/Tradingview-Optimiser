import type {
  BackendCommand,
  NextTrial,
  RunProgress,
  RunUpdate,
  RunAnalysis,
} from './protocol/types';
import { OptimiserError, toOptimiserError, type SerializedOptimiserError } from './errors';

export interface BackendState {
  connected: boolean;
  backendVersion?: string;
  optunaVersion?: string;
  pairingRequired?: boolean;
}

export type BackgroundMessage =
  | { type: 'TOGGLE_UI' }
  | ({ type: 'BACKEND_STATE' } & BackendState)
  | { type: 'RUN_PROGRESS'; progress: RunProgress }
  | { type: 'RUN_UPDATE'; update: RunUpdate }
  | { type: 'NEXT_TRIAL'; trial: NextTrial }
  | { type: 'BACKEND_ERROR'; message: string };

export type ExtensionRequest =
  | BackendCommand
  | { type: 'GET_BACKEND_STATE' }
  | { type: 'BACKEND_CONNECT' }
  | { type: 'PAIR_BACKEND'; payload: { code: string } }
  | { type: 'CLEAR_RUN_OWNER'; payload: { runId: string } }
  | {
      type: 'EXPORT_RESULTS';
      payload: {
        filename: string;
        mimeType: string;
        content: string;
      };
    };

type ResponseFor<R extends ExtensionRequest> = R extends {
  type: 'GET_BACKEND_STATE' | 'BACKEND_CONNECT' | 'PAIR_BACKEND';
}
  ? BackendState
  : R extends { type: 'GET_RUN_ANALYSIS' }
    ? RunAnalysis
    : R extends { type: 'EXPORT_RESULTS' }
      ? { ok: true; downloadId: number }
      : { ok: true };

export async function sendRequest<R extends ExtensionRequest>(request: R): Promise<ResponseFor<R>> {
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(request);
  } catch (cause) {
    throw toOptimiserError(cause, 'EXTENSION_RUNTIME_ERROR', true);
  }
  if (!response || typeof response !== 'object') {
    throw new OptimiserError(
      'EXTENSION_RUNTIME_ERROR',
      'The extension background did not return a valid response',
      true,
    );
  }
  if ('ok' in response && response.ok === false) {
    const error = 'error' in response ? response.error : undefined;
    if (error && typeof error === 'object') {
      const candidate = error as Partial<SerializedOptimiserError>;
      if (
        typeof candidate.code === 'string' &&
        typeof candidate.message === 'string' &&
        typeof candidate.retryable === 'boolean'
      ) {
        throw new OptimiserError(candidate.code, candidate.message, candidate.retryable);
      }
    }
    throw new OptimiserError(
      'BACKGROUND_REQUEST_FAILED',
      typeof error === 'string' ? error : 'Background request failed without a valid error payload',
    );
  }
  return response as ResponseFor<R>;
}

export function subscribeMessages(listener: (message: BackgroundMessage) => void): () => void {
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
