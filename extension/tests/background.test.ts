import { afterEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  subscribe: vi.fn(), connect: vi.fn(async () => {}), createRun: vi.fn(async () => {}),
}));
vi.mock('../lib/backend-client', () => ({ BackendClient: class {
  subscribe = backend.subscribe;
  connect = backend.connect;
  createRun = backend.createRun;
} }));

afterEach(() => vi.unstubAllGlobals());

it('restores ownership before persisting a newly created run', async () => {
  const restored = Promise.withResolvers<{ runOwners: Record<string, number> }>();
  let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => void = () => {};
  const set = vi.fn(async () => {});
  vi.stubGlobal('defineBackground', (start: () => void) => start);
  vi.stubGlobal('browser', {
    storage: { local: { get: vi.fn(() => restored.promise), set } },
    tabs: { query: vi.fn(async () => []) },
    action: { onClicked: { addListener: vi.fn() } },
    runtime: { onMessage: { addListener: vi.fn((callback: typeof listener) => { listener = callback; }) } },
  });
  const { default: start } = await import('../entrypoints/background');
  (start as unknown as () => void)();
  const response = Promise.withResolvers<unknown>();
  listener({ type: 'CREATE_RUN', payload: { run_id: 'new-run' } }, { tab: { id: 2 } }, response.resolve);
  await Promise.resolve();
  expect(backend.createRun).not.toHaveBeenCalled();
  restored.resolve({ runOwners: { 'restored-run': 1 } });
  await expect(response.promise).resolves.toEqual({ ok: true });
  expect(set).toHaveBeenCalledWith({ runOwners: { 'restored-run': 1, 'new-run': 2 } });
});
