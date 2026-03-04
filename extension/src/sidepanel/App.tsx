import Layout from './components/Layout';
import ConnectionStatus from './components/ConnectionStatus';
import MetricSelector from './components/MetricSelector';
import TrialSetup from './components/TrialSetup';
import ParameterConfig from './components/ParameterConfig';
import FilterConfig from './components/FilterConfig';
import AntiDetection from './components/AntiDetection';
import ConfigManager from './components/ConfigManager';
import LiveFeed from './components/LiveFeed';
import ProgressBar from './components/ProgressBar';
import ResultsView from './components/ResultsView';
import { useOptimizationStore } from './store';
import { useShallow } from 'zustand/react/shallow';
import { isActiveRunStatus } from './utils/status';

export default function App() {
  const { status, error, resumeAvailable, startOptimization, isDetecting, resetState } = useOptimizationStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      resumeAvailable: s.resumeAvailable,
      startOptimization: s.startOptimization,
      isDetecting: s.isDetecting,
      resetState: s.resetState,
    })),
  );
  const showSetupSections = status === 'idle' || status === 'detecting' || isDetecting;

  return (
    <Layout>
      <ConnectionStatus />

      {/* Error state */}
      {status === 'error' && (
        <div className="panel-card panel-card-body panel-stack border-danger/40 bg-danger-soft/10">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-danger/40 bg-danger-soft text-danger">
              <svg
                className="w-4 h-4 text-danger"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <span className="block text-[13px] font-semibold text-danger">Optimization Error</span>
              <span className="text-[11px] text-text-muted">Something went wrong during the run</span>
            </div>
          </div>
          {error && (
            <p className="rounded-lg border border-border/45 bg-bg-tertiary/75 p-3 text-[12px] leading-relaxed text-text-secondary">
              {error}
            </p>
          )}
          <div className={`grid gap-2 ${resumeAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {resumeAvailable && (
              <button onClick={() => startOptimization('resume')} className="ui-btn ui-btn-primary w-full">
                Resume Interrupted Run
              </button>
            )}
            <button onClick={resetState} className="ui-btn ui-btn-secondary w-full">
              Reset & Try Again
            </button>
          </div>
        </div>
      )}

      {showSetupSections && (
        <>
          <ConfigManager />
          <MetricSelector />
          <TrialSetup />
          <FilterConfig />
          <AntiDetection />
          <ParameterConfig />
        </>
      )}

      {isActiveRunStatus(status) && (
        <>
          <ProgressBar />
          <LiveFeed />
        </>
      )}

      {status === 'completed' && <ResultsView />}
    </Layout>
  );
}
