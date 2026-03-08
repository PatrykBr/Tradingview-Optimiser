import { useMemo, useState, useEffect } from 'react';
import { useOptimizationStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';
import { getStatusBadgeClassName, isActiveRunStatus } from '../utils/status';

export default function ProgressBar() {
  const { currentTrial, totalTrials, status, startTime, trials, error } = useOptimizationStore(
    useShallow((s) => ({
      currentTrial: s.currentTrial,
      totalTrials: s.totalTrials,
      status: s.status,
      startTime: s.startTime,
      trials: s.trials,
      error: s.error,
    })),
  );

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActiveRunStatus(status)) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status]);

  const percent = totalTrials > 0 ? Math.round((currentTrial / totalTrials) * 100) : 0;

  const elapsed = startTime ? now - startTime : 0;
  const avgTrialTime = useMemo(() => (trials.length > 0 ? elapsed / trials.length : 0), [elapsed, trials.length]);
  const remaining = useMemo(
    () => avgTrialTime * (totalTrials - currentTrial),
    [avgTrialTime, currentTrial, totalTrials],
  );

  function formatTime(ms: number): string {
    if (ms <= 0) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  return (
    <div className="panel-card overflow-hidden">
      <PanelCardHeader
        title="Progress"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
            />
          </svg>
        }
        right={
          <span className={`ui-status-pill capitalize ${getStatusBadgeClassName(status)}`}>
            {status}
          </span>
        }
      />

      <div className="panel-card-body panel-stack">
        {/* Progress bar */}
        <div className="space-y-2.5 rounded-lg border border-border/40 bg-bg-tertiary/35 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-text-secondary">
              Trial <span className="font-mono font-medium">{currentTrial}</span>
              <span className="text-text-muted"> / </span>
              <span className="font-mono font-medium">{totalTrials}</span>
            </span>
            <span className="text-[14px] font-mono font-bold text-text-primary">{percent}%</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full border border-border/45 bg-bg-tertiary/85">
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                status === 'paused' ? 'bg-warning' : 'bg-accent'
              }`}
              style={{ width: `${percent}%` }}
            />
            {status === 'running' && (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/10 animate-pulse"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
        </div>

        {/* Timing stats */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border border-border/45 bg-bg-tertiary/65 px-3 py-2">
            <div className="text-[11px] text-text-muted">Elapsed</div>
            <div className="text-[13px] font-mono font-medium text-text-primary">{formatTime(elapsed)}</div>
          </div>
          <div className="rounded-lg border border-border/45 bg-bg-tertiary/65 px-3 py-2">
            <div className="text-[11px] text-text-muted">Remaining</div>
            <div className="text-[13px] font-mono font-medium text-text-primary">{formatTime(remaining)}</div>
          </div>
        </div>

        {/* Average trial time */}
        {trials.length > 0 && (
          <div className="text-[11px] text-text-muted">
            Avg trial: <span className="font-mono text-text-secondary">{(avgTrialTime / 1000).toFixed(1)}s</span>
          </div>
        )}

        {/* Error display */}
        {error && <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
