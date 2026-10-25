import { mockGlobal } from './helpers/globals';
import { describe, expect, it, mock } from 'bun:test';
import { sendRequest, subscribeMessages } from '../lib/messages';

describe('extension messages', () => {
  it('returns typed state and forwards commands without translating their payload', async () => {
    const state = { connected: true, pairingRequired: false };
    const sendMessage = mock().mockResolvedValueOnce(state).mockResolvedValueOnce({ ok: true });
    mockGlobal('browser', { runtime: { sendMessage } });
    const result = await sendRequest({ type: 'GET_BACKEND_STATE' });
    expect(result.connected).toBe(true);
    const command = {
      type: 'TRIAL_FAILED' as const,
      payload: { run_id: 'run-1234', trial_number: 2, reason: 'runtime error' },
    };
    await sendRequest(command);
    expect(sendMessage).toHaveBeenLastCalledWith(command);
  });

  it('preserves structured background errors and classifies runtime failures', async () => {
    const sendMessage = mock()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'STALE_TRIAL', message: 'already settled', retryable: false },
      })
      .mockRejectedValueOnce(new Error('Extension context invalidated.'))
      .mockResolvedValueOnce(undefined);
    mockGlobal('browser', { runtime: { sendMessage } });
    await expect(sendRequest({ type: 'GET_BACKEND_STATE' })).rejects.toMatchObject({
      code: 'STALE_TRIAL',
      retryable: false,
    });
    await expect(sendRequest({ type: 'GET_BACKEND_STATE' })).rejects.toMatchObject({
      code: 'EXTENSION_CONTEXT_INVALIDATED',
      retryable: true,
    });
    await expect(sendRequest({ type: 'GET_BACKEND_STATE' })).rejects.toMatchObject({
      code: 'EXTENSION_RUNTIME_ERROR',
      retryable: true,
    });
  });

  it('removes the same event listener when the subscriber is disposed', () => {
    const addListener = mock();
    const removeListener = mock();
    mockGlobal('browser', { runtime: { onMessage: { addListener, removeListener } } });
    const listener = mock();
    const unsubscribe = subscribeMessages(listener);
    unsubscribe();
    expect(addListener).toHaveBeenCalledWith(listener);
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
