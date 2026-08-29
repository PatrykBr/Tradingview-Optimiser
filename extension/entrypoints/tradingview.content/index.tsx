import ReactDOM from 'react-dom/client';

import App from '../../components/App';
import '../../components/App.css';

export default defineContentScript({
  matches: ['https://*.tradingview.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    let mounted = true;
    const ui = await createShadowRootUi(ctx, {
      name: 'tradingview-optuna-optimiser',
      position: 'overlay',
      anchor: 'body',
      append: 'last',
      onMount(container) {
        Object.assign(container.style, {
          position: 'fixed',
          top: '12px',
          right: '12px',
          zIndex: '2147483647',
        });

        const app = document.createElement('div');
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();

    browser.runtime.onMessage.addListener((message: { type?: string }) => {
      if (message.type !== 'TOGGLE_UI') return;

      if (mounted) {
        ui.remove();
      } else {
        ui.mount();
      }
      mounted = !mounted;
    });
  },
});
