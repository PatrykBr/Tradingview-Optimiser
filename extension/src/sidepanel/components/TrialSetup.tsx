import { useMemo } from 'react';
import { useOptimizationStore } from '../store';
import type { RunMode, SamplerChoice } from '../../shared/types';
import HistoryManager from './HistoryManager';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';
import { clampNumber, parseNumberOr } from '../utils/number';

const RUN_MODE_OPTIONS: Array<{ value: RunMode; label: string; description: string }> = [
  {
    value: 'fresh',
    label: 'Fresh (Default)',
    description: 'Starts from zero by clearing prior data for this exact objective and search space.',
  },
  {
    value: 'warm_start',
    label: 'Warm Start',
    description: 'Starts a new study and preloads selected compatible completed trials from history.',
  },
];

const SAMPLER_OPTIONS: Array<{ value: SamplerChoice; label: string; description: string }> = [
  {
    value: 'auto',
    label: 'Auto (Recommended)',
    description: 'Lets Optuna AutoSampler choose an algorithm during optimization.',
  },
  {
    value: 'tpe',
    label: 'TPE',
    description: 'Strong general-purpose choice for mixed spaces (numeric + categorical).',
  },
  {
    value: 'random',
    label: 'Random',
    description: 'Uniform random search baseline; good for debugging.',
  },
  {
    value: 'gp',
    label: 'Gaussian Process',
    description: 'Bayesian optimization; can work well for small trial budgets.',
  },
  {
    value: 'qmc',
    label: 'QMC',
    description: 'Quasi-random search for space-filling exploration.',
  },
  {
    value: 'cmaes',
    label: 'CMA-ES',
    description: 'Best for mostly continuous spaces; categorical params are sampled independently.',
  },
];

const RESUME_RUN_MODE_DESCRIPTION = 'Resumes the exact previous study for this objective and search space.';

export default function TrialSetup() {
  const {
    totalTrials,
    runMode,
    sampler,
    resumeAvailable,
    setTotalTrials,
    setRunMode,
    setSampler,
    parameters,
    strategyName,
    strategies,
    selectedStrategyIndex,
    listStrategies,
    selectStrategy,
    detectParams,
    startOptimization,
    isDetecting,
    isListingStrategies,
    backendStatus,
    error,
  } = useOptimizationStore(
    useShallow((s) => ({
      totalTrials: s.totalTrials,
      runMode: s.runMode,
      sampler: s.sampler,
      resumeAvailable: s.resumeAvailable,
      setTotalTrials: s.setTotalTrials,
      setRunMode: s.setRunMode,
      setSampler: s.setSampler,
      parameters: s.parameters,
      strategyName: s.strategyName,
      strategies: s.strategies,
      selectedStrategyIndex: s.selectedStrategyIndex,
      listStrategies: s.listStrategies,
      selectStrategy: s.selectStrategy,
      detectParams: s.detectParameters,
      startOptimization: s.startOptimization,
      isDetecting: s.isDetecting,
      isListingStrategies: s.isListingStrategies,
      backendStatus: s.backendStatus,
      error: s.error,
    })),
  );

  const hasParameters = parameters.length > 0;
  const enabledParams = useMemo(() => parameters.filter((p) => p.enabled), [parameters]);
  const selectedRunModeOption = RUN_MODE_OPTIONS.find((option) => option.value === runMode) ?? null;
  const selectedSamplerOption = SAMPLER_OPTIONS.find((option) => option.value === sampler) ?? SAMPLER_OPTIONS[0];
  const canStart = enabledParams.length > 0 && backendStatus === 'connected' && totalTrials > 0 && !isDetecting;
  const canResume = canStart && resumeAvailable;
  const detectActionLabel = isDetecting
    ? 'Detecting parameters...'
    : hasParameters
      ? `Rescan Parameters (${strategyName})`
      : 'Detect Parameters';

  return (
    <div className="panel-card overflow-hidden">
      <PanelCardHeader
        title="Trial Setup"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
            />
          </svg>
        }
      />

      <div className="panel-card-body panel-stack">
        {/* Strategy Discovery */}
        <div className="panel-field">
          <label className="ui-field-label">Strategy</label>

          {strategies.length === 0 ? (
            <button
              onClick={listStrategies}
              disabled={isListingStrategies}
              className="ui-btn ui-btn-primary w-full"
            >
              {isListingStrategies ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Scanning...
                </span>
              ) : (
                'Scan for Strategies'
              )}
            </button>
          ) : (
            <div className="panel-stack-tight">
              <div className="flex gap-2">
                <select
                  value={selectedStrategyIndex ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val !== '') selectStrategy(Number(val));
                  }}
                  className="ui-select flex-1"
                >
                  <option value="" disabled>
                    Select a strategy...
                  </option>
                  {strategies.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.name}
                      {s.isActive ? ' (active)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={listStrategies}
                  disabled={isListingStrategies}
                  className="ui-btn ui-btn-ghost ui-icon-btn shrink-0 text-[13px] disabled:opacity-50"
                  title="Rescan strategies"
                >
                  {isListingStrategies ? '...' : '\u21BB'}
                </button>
              </div>

              {selectedStrategyIndex !== null && (
                <button
                  onClick={detectParams}
                  disabled={isDetecting}
                  className="ui-btn ui-btn-secondary w-full disabled:opacity-50"
                >
                  {isDetecting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                      {detectActionLabel}
                    </span>
                  ) : (
                    detectActionLabel
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {(hasParameters || error) && (
          <div className="panel-divider panel-stack">
            {hasParameters && (
              <div className="rounded-lg border border-border/45 bg-bg-tertiary/65 px-3.5 py-2.5">
                <div className="text-[12px] text-text-muted">
                  <span className="text-text-primary font-medium">{strategyName}</span>
                  {' \u2014 '}
                  {parameters.length} parameter{parameters.length !== 1 ? 's' : ''} found,{' '}
                  <span className="text-accent font-medium">{enabledParams.length} enabled</span>
                </div>
              </div>
            )}

            {hasParameters && (
              <div className="panel-field">
                <label className="ui-field-label">Number of Trials</label>
                <input
                  type="number"
                  value={totalTrials}
                  onChange={(e) => setTotalTrials(clampNumber(parseNumberOr(e.target.value, 1), 1, 10000))}
                  min={1}
                  max={10000}
                  className="ui-input text-[13px]"
                />
              </div>
            )}

            {hasParameters && (
              <div className="panel-field">
                <div className="flex items-center justify-between">
                  <label className="ui-field-label">Run Mode</label>
                  <span className="text-[10px] text-text-muted">Advanced</span>
                </div>
                <select
                  value={runMode}
                  onChange={(e) => setRunMode(e.target.value as RunMode)}
                  className="ui-select"
                >
                  {RUN_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="ui-note mt-1.5">{runMode === 'resume' ? RESUME_RUN_MODE_DESCRIPTION : selectedRunModeOption?.description}</p>
                {runMode === 'warm_start' && (
                  <div className="panel-stack-tight mt-2">
                    <p className="ui-note">
                      Choose source runs in Trial History below. If none are selected, this run switches to Fresh.
                    </p>
                    <HistoryManager />
                  </div>
                )}
              </div>
            )}

            {hasParameters && (
              <div className="panel-field">
                <div className="flex items-center justify-between">
                  <label className="ui-field-label">Sampler</label>
                  <span className="text-[10px] text-text-muted">Advanced</span>
                </div>
                <select
                  value={sampler}
                  onChange={(e) => setSampler(e.target.value as SamplerChoice)}
                  className="ui-select"
                >
                  {SAMPLER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="ui-note mt-1.5">{selectedSamplerOption.description}</p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-danger/35 bg-danger-soft px-3.5 py-2.5 text-[12px] text-danger">
                {error}
              </div>
            )}

            {hasParameters && (
              <div className="panel-stack-tight">
                <div className={`grid gap-2 ${resumeAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <button
                    onClick={() => startOptimization()}
                    disabled={!canStart}
                    className="ui-btn ui-btn-primary w-full disabled:opacity-40"
                  >
                    Optimize
                  </button>
                  {resumeAvailable && (
                    <button
                      onClick={() => startOptimization('resume')}
                      disabled={!canResume}
                      className="ui-btn ui-btn-secondary w-full disabled:opacity-40"
                      title="Resume interrupted study for this objective and search space"
                    >
                      Resume
                    </button>
                  )}
                </div>
                {resumeAvailable && (
                  <p className="ui-note">
                    Optimize uses selected mode above. Resume is only shown for interrupted-session recovery.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
