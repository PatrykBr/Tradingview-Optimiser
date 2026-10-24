import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackendCommand, Envelope } from '../lib/protocol/types';
import type { ExtensionRequest } from '../lib/messages';

const backend = vi.hoisted(() => ({
  subscribe: vi.fn(),
  connect: vi.fn(async () => {}),
  request: vi.fn<(command: BackendCommand) => Promise<Envelope>>(),
}));
vi.mock('../lib/backend-client', () => ({
  BackendClient: class {
    subscribe = backend.subscribe;
    connect = backend.connect;
    request = backend.request;
  },
}));
beforeEach(() => backend.request.mockReset().mockResolvedValue({ type: 'ACK', payload: {} }));
afterEach(() => vi.unstubAllGlobals());

async function startBackground(
  owners = Promise.resolve({ runOwners: {} as Record<string, number> }),
) {
  let listener: (
    message: unknown,
    sender: unknown,
    reply: (value: unknown) => void,
  ) => void = () => {};
  const set = vi.fn(async () => {});
  vi.stubGlobal('defineBackground', (start: () => void) => start);
  vi.stubGlobal('browser', {
    storage: { local: { get: vi.fn(() => owners), set } },
    tabs: { query: vi.fn(async () => []) },
    action: { onClicked: { addListener: vi.fn() } },
    runtime: {
      onMessage: {
        addListener: vi.fn((callback: typeof listener) => {
          listener = callback;
        }),
      },
    },
  });
  const { default: start } = await import('../entrypoints/background');
  (start as unknown as () => void)();
  return {
    set,
    request: (command: ExtensionRequest) =>
      new Promise<unknown>((resolve) => listener(command, { tab: { id: 2 } }, resolve)),
  };
}

it('restores ownership before persisting a newly created run', async () => {
  const restored = Promise.withResolvers<{ runOwners: Record<string, number> }>();
  const worker = await startBackground(restored.promise);
  const pending = worker.request({
    type: 'CREATE_RUN',
    payload: { run_id: 'new-run' },
  } as ExtensionRequest);
  await Promise.resolve();
  expect(backend.request).not.toHaveBeenCalled();
  restored.resolve({ runOwners: { 'restored-run': 1 } });
  await expect(pending).resolves.toEqual({ ok: true });
  expect(worker.set).toHaveBeenCalledWith({ runOwners: { 'restored-run': 1, 'new-run': 2 } });
});

it('forwards a trial failure unchanged from the content script to the backend', async () => {
  const worker = await startBackground();
  const command = {
    type: 'TRIAL_FAILED' as const,
    payload: { run_id: 'run-1234', trial_number: 3, reason: 'Runtime error' },
  };
  await expect(worker.request(command)).resolves.toEqual({ ok: true });
  expect(backend.request).toHaveBeenCalledWith(command);
});

it('sends a user abort before ownership restoration finishes', async () => {
  const restored = Promise.withResolvers<{ runOwners: Record<string, number> }>();
  const worker = await startBackground(restored.promise);
  const command = {
    type: 'ABORT_RUN' as const,
    payload: { run_id: 'run-1234', reason: 'User stop' },
  };
  const pending = worker.request(command);
  expect(backend.request).toHaveBeenCalledWith(command);
  restored.resolve({ runOwners: { 'run-1234': 2 } });
  await expect(pending).resolves.toEqual({ ok: true });
  expect(worker.set).toHaveBeenCalledWith({ runOwners: {} });
});

it('returns the analysis payload and serializes backend failures', async () => {
  const worker = await startBackground();
  const analysis = { run_id: 'run-1234', parameter_importance: { length: 1 } };
  backend.request.mockResolvedValueOnce({ type: 'RUN_ANALYSIS', payload: analysis });
  await expect(
    worker.request({
      type: 'GET_RUN_ANALYSIS',
      payload: { run_id: 'run-1234', config: {} },
    } as ExtensionRequest),
  ).resolves.toEqual(analysis);
  backend.request.mockRejectedValueOnce(new Error('Backend failed'));
  await expect(
    worker.request({ type: 'START_RUN', payload: { run_id: 'run-1234' } }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'BACKGROUND_REQUEST_FAILED', message: 'Backend failed' },
  });
});
