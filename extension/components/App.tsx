import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../lib/messages';
import {
  formatMetric,
  metricDefinition,
  OPTIMISATION_METRICS,
} from '../lib/optimisation/metrics';
import type {
  CreateRun,
  MetricFilter,
  NextTrial,
  RunProgress,
  SearchParameter,
} from '../lib/protocol/types';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { TradingViewBridge } from '../lib/tradingview/bridge';
import type {
  DetectedStrategy,
  StrategyInput,
  TradingViewMetrics,
} from '../lib/tradingview/types';

interface AppProps {
  bridge: TradingViewBridge;
}

interface ParameterConfig {
  enabled: boolean;
  low: string;
  high: string;
  step: string;
}

interface FilterConfig {
  enabled: boolean;
  value: string;
}

interface TrialExecution {
  number: number;
  parameters: Record<string, unknown>;
  phase: 'applying' | 'recalculating' | 'submitting';
}

const isPrimitive = (
  value: unknown,
): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const isOptimisableInput = (input: StrategyInput): boolean =>
  input.type === 'integer' ||
  input.type === 'float' ||
  input.type === 'boolean' ||
  (input.type === 'categorical' &&
    (input.options?.filter(isPrimitive).length ?? 0) >= 2);

const numberOrThrow = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(label + ' must be a valid number');
  }
  return parsed;
};

const sameChart = (
  expected: { symbol: string; timeframe: string },
  actual: { symbol: string; timeframe: string },
): boolean =>
  expected.symbol === actual.symbol &&
  expected.timeframe === actual.timeframe;

export default function App({ bridge }: AppProps) {
  const adapter = useMemo(() => new TradingViewAdapter(bridge), [bridge]);

  const [strategies, setStrategies] = useState<DetectedStrategy[]>([]);
  const [selected, setSelected] = useState('');
  const [inputs, setInputs] = useState<StrategyInput[]>([]);
  const [parameterConfigs, setParameterConfigs] = useState<
    Record<string, ParameterConfig>
  >({});

  const [connected, setConnected] = useState(false);
  const [optunaVersion, setOptunaVersion] = useState<string>();
  const [objectiveMetric, setObjectiveMetric] = useState('profitFactor');
  const [targetTrials, setTargetTrials] = useState('100');

  const [maxDrawdownFilter, setMaxDrawdownFilter] =
    useState<FilterConfig>({ enabled: false, value: '8' });
  const [minProfitFactorFilter, setMinProfitFactorFilter] =
    useState<FilterConfig>({ enabled: false, value: '1.3' });
  const [minTradesFilter, setMinTradesFilter] =
    useState<FilterConfig>({ enabled: false, value: '100' });

  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [currentTrial, setCurrentTrial] =
    useState<TrialExecution | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const activeRunIdRef = useRef<string | null>(null);
  const activeStrategyIdRef = useRef<string | null>(null);
  const runChartRef = useRef<{
    symbol: string;
    timeframe: string;
  } | null>(null);
  const originalParametersRef = useRef<Record<string, unknown> | null>(
    null,
  );
  const executingTrialRef = useRef<number | null>(null);
  const pendingTrialRef = useRef<NextTrial | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendRequest = useCallback(
    async (request: ExtensionRequest): Promise<unknown> =>
      browser.runtime.sendMessage(request),
    [],
  );

  const applyBackendState = (state: BackendState) => {
    setConnected(state.connected);
    setOptunaVersion(state.optunaVersion);
  };

  const probe = async () => {
    setError(undefined);
    setInputs([]);
    setParameterConfigs({});

    try {
      const detected = await adapter.detectStrategies();
      setStrategies(detected);

      if (detected.length === 1) {
        setSelected(detected[0]!.id);
      } else if (!detected.some((strategy) => strategy.id === selected)) {
        setSelected('');
      }

      if (detected.length === 0) {
        setError('No Pine strategies found on the current TradingView chart.');
      }
    } catch (cause) {
      setStrategies([]);
      setSelected('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const readInputs = async () => {
    if (!selected) return;
    setError(undefined);
    setBusy(true);

    try {
      const detectedInputs = await adapter.readStrategyInputs(selected);
      setInputs(detectedInputs);

      const configs: Record<string, ParameterConfig> = {};
      for (const input of detectedInputs) {
        configs[input.id] = {
          enabled: false,
          low:
            input.type === 'integer' || input.type === 'float'
              ? input.min?.toString() ?? ''
              : '',
          high:
            input.type === 'integer' || input.type === 'float'
              ? input.max?.toString() ?? ''
              : '',
          step:
            input.type === 'integer'
              ? (input.step ?? 1).toString()
              : input.type === 'float'
                ? input.step?.toString() ?? ''
                : '',
        };
      }
      setParameterConfigs(configs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const setParameterEnabled = (id: string, enabled: boolean) => {
    setParameterConfigs((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          enabled: false,
          low: '',
          high: '',
          step: '',
        }),
        enabled,
      },
    }));
  };

  const setParameterField = (
    id: string,
    field: 'low' | 'high' | 'step',
    value: string,
  ) => {
    setParameterConfigs((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          enabled: false,
          low: '',
          high: '',
          step: '',
        }),
        [field]: value,
      },
    }));
  };

  const buildSearchSpace = (): SearchParameter[] => {
    const parameters: SearchParameter[] = [];

    for (const input of inputs) {
      const config = parameterConfigs[input.id];
      if (!config?.enabled) continue;

      if (input.type === 'boolean') {
        parameters.push({
          type: 'categorical',
          name: input.id,
          choices: [true, false],
        });
        continue;
      }

      if (input.type === 'categorical') {
        const choices = (input.options ?? []).filter(isPrimitive);
        if (choices.length < 2) {
          throw new Error(input.label + ' does not expose at least two options');
        }
        parameters.push({
          type: 'categorical',
          name: input.id,
          choices,
        });
        continue;
      }

      if (input.type === 'integer' || input.type === 'float') {
        const low = numberOrThrow(config.low, input.label + ' minimum');
        const high = numberOrThrow(config.high, input.label + ' maximum');
        if (low >= high) {
          throw new Error(input.label + ' minimum must be below its maximum');
        }

        if (input.type === 'integer') {
          if (!Number.isInteger(low) || !Number.isInteger(high)) {
            throw new Error(input.label + ' requires integer bounds');
          }

          const step = config.step
            ? numberOrThrow(config.step, input.label + ' step')
            : 1;
          if (!Number.isInteger(step) || step <= 0) {
            throw new Error(input.label + ' step must be a positive integer');
          }

          parameters.push({
            type: 'int',
            name: input.id,
            low,
            high,
            step,
          });
        } else {
          const step = config.step
            ? numberOrThrow(config.step, input.label + ' step')
            : undefined;
          if (step !== undefined && step <= 0) {
            throw new Error(input.label + ' step must be positive');
          }

          parameters.push({
            type: 'float',
            name: input.id,
            low,
            high,
            ...(step !== undefined ? { step } : {}),
          });
        }
      }
    }

    if (parameters.length === 0) {
      throw new Error('Select at least one parameter to optimise');
    }

    return parameters;
  };

  const buildFilters = (): MetricFilter[] => {
    const filters: MetricFilter[] = [];

    if (maxDrawdownFilter.enabled) {
      filters.push({
        metric: 'maxDrawdownPercent',
        operator: 'lte',
        value: numberOrThrow(
          maxDrawdownFilter.value,
          'Maximum drawdown filter',
        ),
      });
    }

    if (minProfitFactorFilter.enabled) {
      filters.push({
        metric: 'profitFactor',
        operator: 'gte',
        value: numberOrThrow(
          minProfitFactorFilter.value,
          'Minimum profit factor filter',
        ),
      });
    }

    if (minTradesFilter.enabled) {
      filters.push({
        metric: 'totalTrades',
        operator: 'gte',
        value: numberOrThrow(
          minTradesFilter.value,
          'Minimum trades filter',
        ),
      });
    }

    return filters;
  };

  const executeTrial = useCallback(
    async (trial: NextTrial) => {
      if (trial.run_id !== activeRunIdRef.current) return;
      if (executingTrialRef.current !== null) {
        pendingTrialRef.current = trial;
        return;
      }

      const strategyId = activeStrategyIdRef.current;
      const expectedChart = runChartRef.current;
      if (!strategyId || !expectedChart) return;

      executingTrialRef.current = trial.trial_number;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const startedAt = Date.now();

      try {
        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'applying',
        });

        const beforeChart = await adapter.getChartContext();
        if (!sameChart(expectedChart, beforeChart)) {
          throw new Error(
            'TradingView chart changed during optimisation. Expected ' +
              expectedChart.symbol +
              ' ' +
              expectedChart.timeframe +
              ', got ' +
              beforeChart.symbol +
              ' ' +
              beforeChart.timeframe,
          );
        }

        const previousMetrics = await adapter.readMetrics(strategyId);
        await adapter.applyParameters(strategyId, trial.parameters);

        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'recalculating',
        });

        const metrics = await adapter.waitForMetricsAfterChange(
          strategyId,
          previousMetrics,
          controller.signal,
        );

        const afterChart = await adapter.getChartContext();
        if (!sameChart(expectedChart, afterChart)) {
          throw new Error('TradingView chart changed while evaluating the trial');
        }

        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'submitting',
        });

        await sendRequest({
          type: 'TRIAL_RESULT',
          payload: {
            run_id: trial.run_id,
            trial_number: trial.trial_number,
            metrics,
            duration_ms: Date.now() - startedAt,
          },
        });
      } catch (cause) {
        const aborted =
          cause instanceof DOMException && cause.name === 'AbortError';
        const reason = aborted
          ? 'Trial cancelled by user'
          : cause instanceof Error
            ? cause.message
            : String(cause);

        try {
          await sendRequest({
            type: 'TRIAL_FAILED',
            payload: {
              runId: trial.run_id,
              trialNumber: trial.trial_number,
              reason,
            },
          });
        } catch {
          // A backend disconnect is surfaced separately by BACKEND_STATE.
        }

        if (!aborted) setError(reason);
      } finally {
        if (executingTrialRef.current === trial.trial_number) {
          executingTrialRef.current = null;
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }

        const pending = pendingTrialRef.current;
        if (
          pending &&
          pending.run_id === activeRunIdRef.current &&
          executingTrialRef.current === null
        ) {
          pendingTrialRef.current = null;
          queueMicrotask(() => {
            void executeTrial(pending);
          });
        }
      }
    },
    [adapter, sendRequest],
  );

  const startOptimisation = async () => {
    if (!selected) return;
    setError(undefined);
    setBusy(true);

    try {
      if (!connected) {
        throw new Error('Start the local FastAPI backend before optimising');
      }

      const strategy = strategies.find((item) => item.id === selected);
      if (!strategy) throw new Error('Selected strategy is no longer available');

      const parameters = buildSearchSpace();
      const filters = buildFilters();
      const trials = numberOrThrow(targetTrials, 'Number of trials');
      if (!Number.isInteger(trials) || trials < 1 || trials > 100_000) {
        throw new Error('Number of trials must be an integer between 1 and 100,000');
      }

      const metric = metricDefinition(objectiveMetric);
      const chart = await adapter.getChartContext();

      await adapter.ensureStrategyTester();
      const initialMetrics = await adapter.waitForMetricsAfterChange(
        selected,
        null,
        undefined,
        10_000,
      );

      const requiredMetrics = [
        objectiveMetric,
        ...filters.map((filter) => filter.metric),
      ];
      for (const requiredMetric of requiredMetrics) {
        if (!Number.isFinite(initialMetrics[requiredMetric])) {
          throw new Error(
            'TradingView did not expose the required metric: ' +
              metricDefinition(requiredMetric).label,
          );
        }
      }

      const runId = crypto.randomUUID();
      const config: CreateRun = {
        run_id: runId,
        objective_metric: objectiveMetric,
        direction: metric.direction,
        target_trials: trials,
        parameters,
        filters,
        chart: {
          symbol: chart.symbol,
          timeframe: chart.timeframe,
          strategy_name: strategy.name,
        },
      };

      originalParametersRef.current = Object.fromEntries(
        inputs.map((input) => [input.id, input.currentValue]),
      );
      activeStrategyIdRef.current = selected;
      runChartRef.current = chart;
      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      setProgress(null);
      setCurrentTrial(null);
      pendingTrialRef.current = null;

      await sendRequest({ type: 'CREATE_RUN', payload: config });
      await sendRequest({
        type: 'START_RUN',
        payload: { runId },
      });
    } catch (cause) {
      activeRunIdRef.current = null;
      setActiveRunId(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stopOptimisation = async () => {
    const runId = activeRunIdRef.current;
    if (!runId) return;

    setError(undefined);

    const queuedTrial = pendingTrialRef.current;
    pendingTrialRef.current = null;

    try {
      // Tell Optuna first, then abort the browser evaluation. WebSocket message
      // order ensures the failed/cancelled outstanding trial finishes a run that
      // is already in STOP_REQUESTED state.
      await sendRequest({
        type: 'STOP_RUN',
        payload: { runId },
      });

      if (queuedTrial && executingTrialRef.current === null) {
        await sendRequest({
          type: 'TRIAL_FAILED',
          payload: {
            runId,
            trialNumber: queuedTrial.trial_number,
            reason: 'Trial cancelled by user before evaluation started',
          },
        });
      }
    } finally {
      abortControllerRef.current?.abort();
    }
  };

  const applyBestParameters = async () => {
    if (!selected || !progress?.best) return;
    setBusy(true);
    setError(undefined);

    try {
      await adapter.applyParameters(selected, progress.best.parameters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const restoreOriginalParameters = async () => {
    if (!selected || !originalParametersRef.current) return;
    setBusy(true);
    setError(undefined);

    try {
      await adapter.applyParameters(
        selected,
        originalParametersRef.current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void probe();

    const initialiseBackendState = async () => {
      const state = (await sendRequest({
        type: 'GET_BACKEND_STATE',
      })) as BackendState | undefined;

      if (state) applyBackendState(state);

      if (!state?.connected) {
        const connectState = (await sendRequest({
          type: 'BACKEND_CONNECT',
        })) as BackendState | undefined;
        if (connectState) applyBackendState(connectState);
      }
    };

    void initialiseBackendState();

    const listener = (message: BackgroundMessage) => {
      if (message.type === 'BACKEND_STATE') {
        applyBackendState(message);
        return;
      }

      if (message.type === 'BACKEND_ERROR') {
        setError(message.message);
        return;
      }

      if (message.type === 'RUN_PROGRESS') {
        if (message.progress.run_id !== activeRunIdRef.current) return;

        setProgress(message.progress);

        if (
          message.progress.status === 'completed' ||
          message.progress.status === 'stopped' ||
          message.progress.status === 'failed'
        ) {
          activeRunIdRef.current = null;
          pendingTrialRef.current = null;
          setActiveRunId(null);
          setCurrentTrial(null);
        }
        return;
      }

      if (message.type === 'NEXT_TRIAL') {
        void executeTrial(message.trial);
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [adapter, executeTrial, sendRequest]);

  const selectedInputCount = inputs.filter(
    (input) => parameterConfigs[input.id]?.enabled,
  ).length;
  const optimisableInputs = inputs.filter(isOptimisableInput);
  const objective = metricDefinition(objectiveMetric);
  const completion =
    progress && progress.target_trials > 0
      ? Math.min(
          100,
          (progress.completed_trials / progress.target_trials) * 100,
        )
      : 0;

  const inputLabel = (id: string): string =>
    inputs.find((input) => input.id === id)?.label ?? id;

  return (
    <main className="panel">
      <header data-drag-handle title="Drag optimiser">
        <div>
          <div className="eyebrow">TRADINGVIEW</div>
          <h1>Optuna Optimiser</h1>
        </div>
        <span className={connected ? 'status connected' : 'status'}>
          {connected
            ? 'Optuna ' + (optunaVersion ?? 'connected')
            : 'Backend offline'}
        </span>
      </header>

      <section>
        <div className="rowLabel">
          <label htmlFor="strategy">Strategy</label>
          <button
            className="textButton"
            disabled={activeRunId !== null}
            onClick={() => void probe()}
          >
            Refresh
          </button>
        </div>

        <select
          id="strategy"
          value={selected}
          disabled={activeRunId !== null}
          onChange={(event) => {
            setSelected(event.target.value);
            setInputs([]);
            setParameterConfigs({});
            setProgress(null);
          }}
        >
          <option value="">Select strategy…</option>
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name}
            </option>
          ))}
        </select>

        <button
          className="secondary"
          disabled={!selected || busy || activeRunId !== null}
          onClick={() => void readInputs()}
        >
          {inputs.length > 0 ? 'Reload strategy inputs' : 'Read strategy inputs'}
        </button>
      </section>

      {inputs.length > 0 && (
        <>
          <section>
            <div className="rowLabel">
              <strong>Parameters</strong>
              <span className="muted">
                {selectedInputCount}/{optimisableInputs.length} selected
              </span>
            </div>

            <div className="parameterList">
              {inputs.map((input) => {
                const optimisable = isOptimisableInput(input);
                const config = parameterConfigs[input.id];
                const enabled = config?.enabled ?? false;
                const numeric =
                  input.type === 'integer' || input.type === 'float';

                return (
                  <div
                    className={
                      'parameterCard' +
                      (enabled ? ' parameterCardEnabled' : '') +
                      (!optimisable ? ' parameterCardDisabled' : '')
                    }
                    key={input.id}
                  >
                    <label className="parameterHeading">
                      <input
                        type="checkbox"
                        disabled={!optimisable || activeRunId !== null}
                        checked={enabled}
                        onChange={(event) =>
                          setParameterEnabled(input.id, event.target.checked)
                        }
                      />
                      <span className="parameterName">
                        <strong>{input.label}</strong>
                        <small>
                          {input.type} · current {String(input.currentValue)}
                        </small>
                      </span>
                    </label>

                    {enabled && numeric && (
                      <div className="rangeGrid">
                        <label>
                          <span>Min</span>
                          <input
                            type="number"
                            value={config?.low ?? ''}
                            disabled={activeRunId !== null}
                            onChange={(event) =>
                              setParameterField(
                                input.id,
                                'low',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>Max</span>
                          <input
                            type="number"
                            value={config?.high ?? ''}
                            disabled={activeRunId !== null}
                            onChange={(event) =>
                              setParameterField(
                                input.id,
                                'high',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>Step</span>
                          <input
                            type="number"
                            value={config?.step ?? ''}
                            disabled={activeRunId !== null}
                            placeholder={input.type === 'integer' ? '1' : 'auto'}
                            onChange={(event) =>
                              setParameterField(
                                input.id,
                                'step',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                    )}

                    {enabled && input.type === 'boolean' && (
                      <div className="choiceHint">Optimise false / true</div>
                    )}

                    {enabled && input.type === 'categorical' && (
                      <div className="choiceHint">
                        {(input.options ?? []).map(String).join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <strong>Optimisation</strong>

            <div className="fieldGrid">
              <label>
                <span>Metric</span>
                <select
                  value={objectiveMetric}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setObjectiveMetric(event.target.value)
                  }
                >
                  {OPTIMISATION_METRICS.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Trials</span>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={targetTrials}
                  disabled={activeRunId !== null}
                  onChange={(event) => setTargetTrials(event.target.value)}
                />
              </label>
            </div>

            <div className="filterList">
              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={maxDrawdownFilter.enabled}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMaxDrawdownFilter((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>Max drawdown %</span>
                <input
                  type="number"
                  value={maxDrawdownFilter.value}
                  disabled={
                    !maxDrawdownFilter.enabled || activeRunId !== null
                  }
                  onChange={(event) =>
                    setMaxDrawdownFilter((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={minProfitFactorFilter.enabled}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMinProfitFactorFilter((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>Min profit factor</span>
                <input
                  type="number"
                  step="0.01"
                  value={minProfitFactorFilter.value}
                  disabled={
                    !minProfitFactorFilter.enabled || activeRunId !== null
                  }
                  onChange={(event) =>
                    setMinProfitFactorFilter((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={minTradesFilter.enabled}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMinTradesFilter((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>Min trades</span>
                <input
                  type="number"
                  value={minTradesFilter.value}
                  disabled={!minTradesFilter.enabled || activeRunId !== null}
                  onChange={(event) =>
                    setMinTradesFilter((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            {activeRunId === null ? (
              <button
                className="primary"
                disabled={!connected || busy || selectedInputCount === 0}
                onClick={() => void startOptimisation()}
              >
                {busy ? 'Preparing…' : 'Start optimisation'}
              </button>
            ) : (
              <button
                className="danger"
                onClick={() => void stopOptimisation()}
              >
                Stop optimisation
              </button>
            )}
          </section>
        </>
      )}

      {(progress || currentTrial) && (
        <section>
          <div className="rowLabel">
            <strong>Progress</strong>
            <span className="muted">
              {progress?.completed_trials ?? 0}/
              {progress?.target_trials ?? targetTrials}
            </span>
          </div>

          <div className="progressTrack">
            <div
              className="progressFill"
              style={{ width: completion + '%' }}
            />
          </div>

          {currentTrial && (
            <div className="currentTrial">
              Trial #{currentTrial.number} ·{' '}
              {currentTrial.phase === 'applying'
                ? 'applying parameters'
                : currentTrial.phase === 'recalculating'
                  ? 'waiting for TradingView'
                  : 'submitting result'}
            </div>
          )}

          {progress?.best && (
            <div className="bestCard">
              <div className="rowLabel">
                <strong>Best feasible result</strong>
                <span className="bestValue">
                  {objective.label}{' '}
                  {formatMetric(
                    objectiveMetric,
                    progress.best.objective_value,
                  )}
                </span>
              </div>

              <div className="compactMetrics">
                {[
                  'profitFactor',
                  'netProfitPercent',
                  'maxDrawdownPercent',
                  'totalTrades',
                  'sharpeRatio',
                  'sortinoRatio',
                ]
                  .filter(
                    (key) =>
                      progress.best &&
                      Number.isFinite(progress.best.metrics[key]),
                  )
                  .map((key) => (
                    <div key={key}>
                      <span>{metricDefinition(key).label}</span>
                      <strong>
                        {formatMetric(
                          key,
                          progress.best!.metrics[key]!,
                        )}
                      </strong>
                    </div>
                  ))}
              </div>

              <div className="bestParameters">
                {Object.entries(progress.best.parameters).map(
                  ([id, value]) => (
                    <div key={id}>
                      <span>{inputLabel(id)}</span>
                      <code>{String(value)}</code>
                    </div>
                  ),
                )}
              </div>

              <div className="buttonRow">
                <button
                  className="secondary"
                  disabled={activeRunId !== null || busy}
                  onClick={() => void applyBestParameters()}
                >
                  Apply best
                </button>
                <button
                  className="textButton"
                  disabled={activeRunId !== null || busy}
                  onClick={() => void restoreOriginalParameters()}
                >
                  Restore original
                </button>
              </div>
            </div>
          )}

          {progress && progress.trials.length > 0 && (
            <div className="trialList">
              {progress.trials
                .slice()
                .reverse()
                .map((trial) => {
                  const feasible =
                    trial.state === 'complete' &&
                    Object.values(trial.constraints).every(
                      (value) => value <= 0,
                    );

                  return (
                    <div className="trialRow" key={trial.trial_number}>
                      <span>#{trial.trial_number}</span>
                      <strong>
                        {trial.objective_value === null
                          ? 'Failed'
                          : formatMetric(
                              objectiveMetric,
                              trial.objective_value,
                            )}
                      </strong>
                      <span
                        className={
                          trial.state === 'failed'
                            ? 'trialState failed'
                            : feasible
                              ? 'trialState feasible'
                              : 'trialState constrained'
                        }
                      >
                        {trial.state === 'failed'
                          ? 'failed'
                          : feasible
                            ? 'valid'
                            : 'filtered'}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {progress?.best && activeRunId === null && (
        <section>
          <strong>Best performance metrics</strong>
          <div className="metricsList">
            {Object.entries(progress.best.metrics)
              .filter(([key]) => !key.startsWith('tv.'))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key}>
                  <span>{metricDefinition(key).label}</span>
                  <code>{formatMetric(key, value)}</code>
                </div>
              ))}
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}
    </main>
  );
}
