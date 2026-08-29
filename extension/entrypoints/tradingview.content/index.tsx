import ReactDOM from 'react-dom/client';

import App from '../../components/App';
import '../../components/App.css';
import { TradingViewBridge } from '../../lib/tradingview/bridge';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

const makeDraggable = (element: HTMLElement): (() => void) => {
  let drag: DragState | null = null;

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-drag-handle]')) return;
    if (target.closest('button, select, input, a')) return;

    const rect = element.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };

    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.left = rect.left + 'px';
    element.style.top = rect.top + 'px';

    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);

    const left = Math.min(
      maxLeft,
      Math.max(8, drag.startLeft + event.clientX - drag.startX),
    );
    const top = Math.min(
      maxTop,
      Math.max(8, drag.startTop + event.clientY - drag.startY),
    );

    element.style.left = left + 'px';
    element.style.top = top + 'px';
  };

  const stopDragging = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
  };

  element.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
  };
};

export default defineContentScript({
  matches: ['https://*.tradingview.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    let bridgeScript: HTMLScriptElement | undefined;

    await injectScript('/tradingview-main-world.js', {
      keepInDom: true,
      modifyScript(script) {
        bridgeScript = script;
      },
    });

    if (!bridgeScript) {
      throw new Error('Could not initialise the TradingView page bridge');
    }

    const bridge = new TradingViewBridge(bridgeScript);
    let mounted = true;
    let removeDragListeners: (() => void) | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: 'tradingview-optuna-optimiser',
      position: 'overlay',
      anchor: 'body',
      append: 'last',
      onMount(container) {
        // The WXT overlay can span the page. It must never intercept TradingView
        // input outside the visible optimiser panel.
        Object.assign(container.style, {
          pointerEvents: 'none',
          zIndex: '2147483647',
        });

        const app = document.createElement('div');
        Object.assign(app.style, {
          position: 'fixed',
          right: '12px',
          bottom: '12px',
          pointerEvents: 'auto',
          zIndex: '2147483647',
        });
        container.append(app);

        removeDragListeners = makeDraggable(app);

        const root = ReactDOM.createRoot(app);
        root.render(<App bridge={bridge} />);
        return root;
      },
      onRemove(root) {
        removeDragListeners?.();
        removeDragListeners = undefined;
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
