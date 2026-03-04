import { sleep } from '../utils/delay';
import { SELECTORS } from './selectors';

export interface EnsurePanelOpenOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export function simulatePointerClick(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const shared = { bubbles: true, clientX, clientY };

  el.dispatchEvent(new PointerEvent('pointerdown', { ...shared, pointerId: 1, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', shared));
  el.dispatchEvent(new PointerEvent('pointerup', { ...shared, pointerId: 1, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mouseup', shared));
  el.dispatchEvent(new MouseEvent('click', shared));
}

export function findBacktestingPanel(): HTMLElement | null {
  return document.querySelector(SELECTORS.backtestingPanel) as HTMLElement | null;
}

export async function ensureBacktestingPanelOpen(options: EnsurePanelOpenOptions = {}): Promise<HTMLElement | null> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 60;

  let panel = findBacktestingPanel();
  if (panel) return panel;

  const toggleBtn = document.querySelector(SELECTORS.backtestingToggle) as HTMLButtonElement | null;
  if (!toggleBtn) return null;

  const isActive =
    toggleBtn.getAttribute('data-active') === 'true' ||
    /close strategy report/i.test(toggleBtn.getAttribute('aria-label') ?? '');
  if (!isActive) {
    toggleBtn.click();
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    panel = findBacktestingPanel();
    if (panel) return panel;
    await sleep(pollIntervalMs);
  }

  return null;
}
