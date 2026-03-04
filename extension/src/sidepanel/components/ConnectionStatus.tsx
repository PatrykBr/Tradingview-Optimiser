import { useOptimizationStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

export default function ConnectionStatus() {
  const { backendStatus, retryBackend } = useOptimizationStore(
    useShallow((s) => ({
      backendStatus: s.backendStatus,
      retryBackend: s.retryBackend,
    })),
  );

  // Keep connection state in the same card shell as other sections.
  if (backendStatus === 'connected') {
    return (
      <div className="panel-card panel-card-body">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-full bg-success shadow-[0_0_10px_rgba(87,217,146,0.45)]" />
          <span className="text-[11px] text-text-muted">Backend connected</span>
        </div>
      </div>
    );
  }

  const statusConfig = {
    connecting: {
      color: 'bg-warning',
      text: 'Connecting to backend...',
      textColor: 'text-warning',
      borderColor: 'border-warning/30',
    },
    disconnected: {
      color: 'bg-danger',
      text: 'Backend Offline',
      textColor: 'text-danger',
      borderColor: 'border-danger/30',
    },
    error: { color: 'bg-danger', text: 'Connection Error', textColor: 'text-danger', borderColor: 'border-danger/30' },
  };

  const config = statusConfig[backendStatus];

  return (
    <div className={`panel-card panel-card-body flex items-center justify-between gap-2 ${config.borderColor}`}>
      <div className="flex items-center gap-2.5">
        <div
          className={`h-2 w-2 rounded-full ${config.color} ${backendStatus === 'connecting' ? 'ui-pulse-dot' : ''}`}
        />
        <span className={`text-[12px] font-medium ${config.textColor}`}>{config.text}</span>
      </div>
      <button onClick={retryBackend} className="ui-btn ui-btn-ghost px-3 py-1.5 text-[11px]">
        Retry
      </button>
    </div>
  );
}
