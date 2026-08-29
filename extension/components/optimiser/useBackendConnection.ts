import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

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
): string | null => {
  if (
    !response ||
    typeof response !== 'object'
  ) {
    return null;
  }

  const record =
    response as Record<string, unknown>;

  return record.ok === false &&
    typeof record.error === 'string'
    ? record.error
    : null;
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
      const response =
        await browser.runtime.sendMessage(
          request,
        );
      const message = responseError(response);

      if (message) {
        throw new Error(message);
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

    browser.runtime.onMessage.addListener(
      listener,
    );

    return () =>
      browser.runtime.onMessage.removeListener(
        listener,
      );
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

export type BackendConnectionModel =
  ReturnType<typeof useBackendConnection>;
