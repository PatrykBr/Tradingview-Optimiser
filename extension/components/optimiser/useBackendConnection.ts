import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { BackendState, BackgroundMessage } from '../../lib/messages';
import { sendRequest } from '../../lib/messages';

type ErrorSetter = Dispatch<SetStateAction<string | undefined>>;

export function useBackendConnection(setError: ErrorSetter) {
  const [backendState, setBackendState] = useState<BackendState>({
    connected: false,
    pairingRequired: false,
  });
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);

  const pairBackend = useCallback(async () => {
    if (!pairingCode.trim()) return;

    setBusy(true);
    setError(undefined);

    try {
      const state = await sendRequest({
        type: 'PAIR_BACKEND',
        payload: {
          code: pairingCode.trim(),
        },
      });

      setBackendState(state);
      setPairingCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [pairingCode, sendRequest, setError]);

  useEffect(() => {
    const initialise = async () => {
      const state = await sendRequest({
        type: 'GET_BACKEND_STATE',
      });

      setBackendState(state);

      if (!state.connected && !state.pairingRequired) {
        setBackendState(
          await sendRequest({
            type: 'BACKEND_CONNECT',
          }),
        );
      }
    };

    void initialise().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [sendRequest, setError]);

  useEffect(() => {
    const listener = (message: BackgroundMessage) => {
      if (message.type === 'BACKEND_STATE') {
        setBackendState(message);
        return;
      }

      if (message.type === 'BACKEND_ERROR') {
        setError(message.message);
      }
    };

    try {
      browser.runtime.onMessage.addListener(listener);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    return () => {
      try {
        browser.runtime.onMessage.removeListener(listener);
      } catch (cause) {
        console.warn('Could not remove optimiser backend listener during teardown', cause);
      }
    };
  }, [setError]);

  return {
    connected: backendState.connected,
    pairingRequired: backendState.pairingRequired ?? false,
    pairingCode,
    backendVersion: backendState.backendVersion,
    optunaVersion: backendState.optunaVersion,
    busy,
    setPairingCode,
    pairBackend,
    sendRequest,
  };
}
