import { useEffect, type ReactNode } from 'react';
import { useOptimizationStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: Readonly<LayoutProps>) {
  const { init, disconnect, status } = useOptimizationStore(
    useShallow((s) => ({
      init: s.init,
      disconnect: s.disconnect,
      status: s.status,
    })),
  );

  useEffect(() => {
    init();
    return () => disconnect();
  }, [init, disconnect]);

  return (
    <div className="panel-shell text-text-primary">
      <div className="panel-surface">
        <header className="relative border-b border-border/40 px-4 py-2.5">
          <div className="absolute inset-0 bg-[linear-gradient(95deg,rgba(46,201,168,0.08),rgba(46,201,168,0)_42%),linear-gradient(180deg,rgba(56,82,96,0.2),rgba(56,82,96,0)_80%)]" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-accent/28 bg-accent-soft text-accent shadow-[0_0_12px_rgba(46,201,168,0.17)]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div>
                <h1
                  className="text-[11.5px] font-semibold leading-tight text-text-primary tracking-[0.045em]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Strategy Optimizer
                </h1>
                <p className="text-[10px] text-text-muted leading-tight">Control Panel</p>
              </div>
            </div>
            {status !== 'idle' && (
              <span className="ui-status-pill border-accent/40 bg-accent-soft text-accent">{status}</span>
            )}
          </div>
        </header>

        <main className="panel-main">
          <div className="panel-card-stack">{children}</div>
        </main>
      </div>
    </div>
  );
}
