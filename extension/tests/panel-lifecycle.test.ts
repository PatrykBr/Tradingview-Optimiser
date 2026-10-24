import { mockGlobal } from './helpers/globals';
import { expect, it, mock } from 'bun:test';

mock.module('../lib/tradingview/bridge', () => ({
  TradingViewBridge: class {
    dispose = mock();
  },
}));
mock.module('../components/App', () => ({ default: () => null }));

it('hides and shows the mounted panel without dropping its active workflow', async () => {
  let listener: (message: { type: string }) => void = () => {};
  const ui = {
    mount: mock(),
    remove: mock(),
    shadowHost: { style: { display: '' } },
  };
  mockGlobal('defineContentScript', (definition: unknown) => definition);
  mockGlobal(
    'injectScript',
    async (_path: string, options: { modifyScript(script: unknown): void }) => {
      options.modifyScript({});
    },
  );
  mockGlobal(
    'createShadowRootUi',
    mock(async () => ui),
  );
  mockGlobal('browser', {
    runtime: {
      onMessage: {
        addListener: mock((callback: typeof listener) => {
          listener = callback;
        }),
      },
    },
  });
  const { default: content } = await import('../entrypoints/tradingview.content/index');
  await content.main({ onInvalidated: mock() } as never);

  listener({ type: 'TOGGLE_UI' });
  expect(ui.shadowHost.style.display).toBe('none');
  listener({ type: 'TOGGLE_UI' });
  expect(ui.shadowHost.style.display).toBe('');
  expect(ui.mount).toHaveBeenCalledTimes(1);
  expect(ui.remove).not.toHaveBeenCalled();
});
