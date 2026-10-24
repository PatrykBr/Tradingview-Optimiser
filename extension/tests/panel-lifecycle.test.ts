import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/tradingview/bridge', () => ({ TradingViewBridge: class {
  dispose = vi.fn();
} }));
vi.mock('../components/App', () => ({ default: () => null }));

afterEach(() => vi.unstubAllGlobals());

it('hides and shows the mounted panel without dropping its active workflow', async () => {
  let listener: (message: { type: string }) => void = () => {};
  const ui = {
    mount: vi.fn(), remove: vi.fn(), shadowHost: { style: { display: '' } },
  };
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('injectScript', async (_path: string, options: { modifyScript(script: unknown): void }) => {
    options.modifyScript({});
  });
  vi.stubGlobal('createShadowRootUi', vi.fn(async () => ui));
  vi.stubGlobal('browser', { runtime: { onMessage: {
    addListener: vi.fn((callback: typeof listener) => { listener = callback; }),
  } } });
  const { default: content } = await import('../entrypoints/tradingview.content/index');
  await content.main({ onInvalidated: vi.fn() } as never);

  listener({ type: 'TOGGLE_UI' });
  expect(ui.shadowHost.style.display).toBe('none');
  listener({ type: 'TOGGLE_UI' });
  expect(ui.shadowHost.style.display).toBe('');
  expect(ui.mount).toHaveBeenCalledTimes(1);
  expect(ui.remove).not.toHaveBeenCalled();
});
