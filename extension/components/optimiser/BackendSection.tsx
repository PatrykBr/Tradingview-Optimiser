import type { OptimisationRunModel } from './useOptimisationRun';

interface BackendSectionProps {
  run: OptimisationRunModel;
  busy: boolean;
}

export default function BackendSection({ run, busy }: BackendSectionProps) {
  return (
    <>
      <header data-drag-handle title="Drag optimiser">
        <div>
          <div className="eyebrow">TRADINGVIEW</div>
          <h1>Optuna Optimiser</h1>
        </div>
        <span className={run.connected ? 'status connected' : 'status'}>
          {run.connected
            ? 'Optuna ' + (run.optunaVersion ?? 'connected')
            : run.pairingRequired
              ? 'Pair backend'
              : 'Backend offline'}
        </span>
      </header>

      {run.watchdog.status !== 'idle' && (
        <div className={'watchdogBanner ' + run.watchdog.status}>
          <span className="watchdogDot" aria-hidden="true" />
          <div>
            <strong>
              TradingView watchdog{' '}
              {run.watchdog.status === 'healthy' ? 'healthy' : 'stopped the run'}
            </strong>
            <small>
              {run.watchdog.status === 'healthy' && run.watchdog.lastSuccessfulTrialAt
                ? 'Last successful trial ' +
                  new Date(run.watchdog.lastSuccessfulTrialAt).toLocaleTimeString()
                : (run.watchdog.lastFailure ?? 'Compatibility checks passed.')}
            </small>
          </div>
        </div>
      )}

      {run.pairingRequired && (
        <section className="pairingCard">
          <strong>Pair local backend</strong>
          <p className="helpText">Enter the pairing code printed in the backend terminal.</p>
          <div className="inlineForm">
            <input
              aria-label="Backend pairing code"
              value={run.pairingCode}
              placeholder="Pairing code"
              autoComplete="off"
              onChange={(event) => run.setPairingCode(event.target.value)}
            />
            <button
              className="primary compactButton"
              disabled={busy || !run.pairingCode.trim()}
              onClick={() => void run.pairBackend()}
            >
              Pair
            </button>
          </div>
        </section>
      )}

      {run.resumeCandidate && run.activeRunId === null && (
        <section className="resumeCard">
          <strong>Unfinished optimisation found</strong>
          <p className="helpText">
            {run.resumeCandidate.config.chart.strategy_name} ·{' '}
            {run.resumeCandidate.lastProgress?.completed_trials ?? 0}/
            {run.resumeCandidate.config.target_trials} trials
          </p>
          <div className="buttonRow twoButtons">
            <button
              className="primary"
              disabled={busy || !run.connected}
              onClick={() => void run.resumeOptimisation()}
            >
              Resume
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run.discardResumeCandidate()}
            >
              Discard
            </button>
          </div>
        </section>
      )}
    </>
  );
}
