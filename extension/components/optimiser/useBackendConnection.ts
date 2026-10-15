import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  OptimiserError,
  toOptimiserError,
  type SerializedOptimiserError,
} from '../../lib/errors';
import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../../lib/messages';

type ErrorSetter = Dispatch<
  SetStateAction<string | undefined>
>;

const responseError = (
  response: unknown,
): SerializedOptimiserError | null => {
  if (
    !response ||
    typeof response !== 'object'
  ) {
    return null;
  }

  const record =
    response as Record<string, unknown>;
  if (record.ok !== false) {
    return null;
  }

  const error = record.error;
  if (typeof error === 'string') {
    return {
      code: 'BACKGROUND_REQUEST_FAILED',
      message: error,
      retryable: false,
    };
  }

  if (
    error &&
    typeof error === 'object'
  ) {
    const candidate =
      error as Partial<SerializedOptimiserError>;
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.retryable === 'boolean'
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }

  return {
    code: 'BACKGROUND_REQUEST_FAILED',
    message:
      'Background request failed without a valid error payload',
    retryable: false,
  };
};

export function useBackendConnection(
  setError: ErrorSetter,
) {
  const [backendState, setBackendState] =
    useState<BackendState>({
      connected: false,
      pairingRequired: false,
    });
  const [pairingCode, setPairingCode] =
    useState('');
  const [busy, setBusy] = useState(false);

  const sendRequest = useCallback(
    async <T,>(
      request: ExtensionRequest,
    ): Promise<T> => {
      let response: unknown;

      try {
        response =
          await browser.runtime.sendMessage(
            request,
          );
      } catch (cause) {
        throw toOptimiserError(
          cause,
          'EXTENSION_RUNTIME_ERROR',
          true,
        );
      }

      const error =
        responseError(response);

      if (error) {
        throw new OptimiserError(
          error.code,
          error.message,
          error.retryable,
        );
      }

      return response as T;
    },
    [],
  );

  const pairBackend =
    useCallback(async () => {
      if (!pairingCode.trim()) return;

      setBusy(true);
      setError(undefined);

      try {
        const state =
          await sendRequest<BackendState>({
            type: 'PAIR_BACKEND',
            payload: {
              code: pairingCode.trim(),
            },
          });

        setBackendState(state);
        setPairingCode('');
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [
      pairingCode,
      sendRequest,
      setError,
    ]);

  useEffect(() => {
    const initialise = async () => {
      const state =
        await sendRequest<BackendState>({
          type: 'GET_BACKEND_STATE',
        });

      setBackendState(state);

      if (
        !state.connected &&
        !state.pairingRequired
      ) {
        setBackendState(
          await sendRequest<BackendState>({
            type: 'BACKEND_CONNECT',
          }),
        );
      }
    };

    void initialise().catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    });
  }, [
    sendRequest,
    setError,
  ]);

  useEffect(() => {
    const listener = (
      message: BackgroundMessage,
    ) => {
      if (
        message.type === 'BACKEND_STATE'
      ) {
        setBackendState(message);
        return;
      }

      if (
        message.type === 'BACKEND_ERROR'
      ) {
        setError(message.message);
      }
    };

    try {
      browser.runtime.onMessage.addListener(
        listener,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
      return;
    }

    return () => {
      try {
        browser.runtime.onMessage.removeListener(
          listener,
        );
      } catch (cause) {
        console.warn(
          'Could not remove optimiser backend listener during teardown',
          cause,
        );
      }
    };
  }, [setError]);

  return {
    connected:
      backendState.connected,
    pairingRequired:
      backendState.pairingRequired ?? false,
    pairingCode,
    backendVersion:
      backendState.backendVersion,
    optunaVersion:
      backendState.optunaVersion,
    busy,
    setPairingCode,
    pairBackend,
    sendRequest,
  };
}
