import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import BestSoFarChart from './BestSoFarChart';
import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../lib/messages';
import {
  buildRunJson,
  buildTrialsCsv,
} from '../lib/optimisation/export';
import {
  formatMetric,
  metricDefinition,
  OPTIMISATION_METRICS,
} from '../lib/optimisation/metrics';
import {
  bestSoFar,
  estimateRemainingMs,
  filterTrials,
  isFeasibleTrial,
  sortTrials,
  type TrialFilter,
  type TrialSort,
} from '../lib/optimisation/results';
import {
  buildBaselineParameters,
  buildSearchSpace,
  conditionCandidatesFor,
  defaultParameterConfig,
  isOptimisableInput,
  type ParameterConfig,
} from '../lib/optimisation/search-space';
import {
  clearActiveRun,
  finishActiveRun,
  loadActiveRun,
  loadLastRun,
  saveActiveRun,
  updateActiveRunProgress,
  type PersistedOptimisationRun,
} from '../lib/optimisation/storage';
import type {
  CreateRun,
  MetricFilter,
  NextTrial,
  Primitive,
  RunProgress,
  TrialSummary,
} from '../lib/protocol/types';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { TradingViewBridge } from '../lib/tradingview/bridge';
import type {
  DetectedStrategy,
  StrategyInput,
  TradingViewDiagnostics,
  TradingViewMetrics,
} from '../lib/tradingview/types';

interface AppProps {
  bridge: TradingViewBridge;
}

interface FilterConfig {
  enabled: boolean;
  value: string;
}

interface TrialExecution {
  number: number;
  parameters: Record<string, unknown>;
  phase:
    | 'checking'
    | 'applying'
    | 'recalculating'
    | 'submitting';
}

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

const formatDuration = (milliseconds: number | null): string => {
  if (milliseconds === null || !Number.isFinite(milliseconds)) {
    return '—';
  }

  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return hours + 'h ' + minutes + 'm';
  }
  if (minutes > 0) {
    return minutes + 'm ' + remainingSeconds + 's';
  }
  return remainingSeconds + 's';
};

const safeFilename = (value: string): string =>
  value
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'optimisation';

const responseError = (response: unknown): string | null => {
  if (!response || typeof response !== 'object') return null;
  const record = response as Record<string, unknown>;
  return record.ok === false && typeof record.error === 'string'
    ? record.error
    : null;
};

const isBackendTransportError = (message: string): boolean =>
  /backend (is not connected|connection closed|request timed out)|backend client disconnected/i.test(
    message,
  );

const configsFromRun = (
  inputs: StrategyInput[],
  config: CreateRun,
): Record<string, ParameterConfig> => {
  const configs = Object.fromEntries(
    inputs.map((input) => [
      input.id,
      defaultParameterConfig(input),
    ]),
  ) as Record<string, ParameterConfig>;

  for (const parameter of config.parameters) {
    const current = configs[parameter.name];
    if (!current) continue;

    const next: ParameterConfig = {
      ...current,
      enabled: true,
      conditionParameter: parameter.condition?.parameter ?? '',
      conditionValues: parameter.condition?.values ?? [],
    };

    if (parameter.type === 'categorical') {
      next.choices = parameter.choices;
    } else {
      next.low = String(parameter.low);
      next.high = String(parameter.high);
      next.step =
        parameter.type === 'int'
          ? String(parameter.step ?? 1)
          : parameter.step?.toString() ?? '';
      next.log = parameter.log ?? false;
    }

    configs[parameter.name] = next;
  }

  return configs;
};

export default function App({ bridge }: AppProps) {
  const adapter = useMemo(
    () => new TradingViewAdapter(bridge),
    [bridge],
  );

  const [strategies, setStrategies] = useState<DetectedStrategy[]>([]);
  const [selected, setSelected] = useState('');
  const [inputs, setInputs] = useState<StrategyInput[]>([]);
  const [parameterConfigs, setParameterConfigs] = useState<
    Record<string, ParameterConfig>
  >({});

  const [connected, setConnected] = useState(false);
  const [pairingRequired, setPairingRequired] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [optunaVersion, setOptunaVersion] = useState<string>();

  const [objectiveMetric, setObjectiveMetric] =
    useState('profitFactor');
  const [targetTrials, setTargetTrials] = useState('100');

  const [maxDrawdownFilter, setMaxDrawdownFilter] =
    useState<FilterConfig>({ enabled: false, value: '8' });
  const [minProfitFactorFilter, setMinProfitFactorFilter] =
    useState<FilterConfig>({ enabled: false, value: '1.3' });
  const [minTradesFilter, setMinTradesFilter] =
    useState<FilterConfig>({ enabled: false, value: '100' });

  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [runConfig, setRunConfig] = useState<CreateRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(
    null,
  );
  const [currentTrial, setCurrentTrial] =
    useState<TrialExecution | null>(null);
  const [resumeCandidate, setResumeCandidate] =
    useState<PersistedOptimisationRun | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<TradingViewDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const [trialFilter, setTrialFilter] =
    useState<TrialFilter>('all');
  const [trialSort, setTrialSort] =
    useState<TrialSort>('trial-desc');
  const [selectedTrialNumber, setSelectedTrialNumber] =
    useState<number | null>(null);

  const [stopChoiceVisible, setStopChoiceVisible] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());

  const activeRunIdRef = useRef<string | null>(null);
  const activeStrategyIdRef = useRef<string | null>(null);
  const activeConfigRef = useRef<CreateRun | null>(null);
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
  const recoveringBackendRef = useRef(false);
  const consecutiveExecutionFailuresRef = useRef(0);
  const wasConnectedRef = useRef(false);

  const sendRequest = useCallback(
    async <T,>(request: ExtensionRequest): Promise<T> => {
      const response = await browser.runtime.sendMessage(request);
      const message = responseError(response);
      if (message) throw new Error(message);
      return response as T;
    },
    [],
  );

  const applyBackendState = useCallback((state: BackendState) => {
    setConnected(state.connected);
    setPairingRequired(state.pairingRequired ?? false);
    setOptunaVersion(state.optunaVersion);
  }, []);

  const probe = useCallback(async () => {
    setError(undefined);

    try {
      const detected = await adapter.detectStrategies();
      setStrategies(detected);

      if (detected.length === 1) {
        setSelected(detected[0]!.id);
      } else {
        setSelected((current) =>
          detected.some((strategy) => strategy.id === current)
            ? current
            : '',
        );
      }

      if (detected.length === 0) {
        setError(
          'No Pine strategies found on the current TradingView chart.',
        );
      }
    } catch (cause) {
      setStrategies([]);
      setSelected('');
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }, [adapter]);

  const runDiagnostics = useCallback(async () => {
    setError(undefined);

    try {
      await adapter.ensureStrategyTester();
      const result = await adapter.diagnostics(
        selected || undefined,
      );
      setDiagnostics(result);
      setDiagnosticsOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }, [adapter, selected]);

  const loadInputs = useCallback(
    async (
      strategyId: string,
      restoreConfig?: CreateRun,
    ): Promise<StrategyInput[]> => {
      const detectedInputs =
        await adapter.readStrategyInputs(strategyId);
      setInputs(detectedInputs);

      setParameterConfigs(
        restoreConfig
          ? configsFromRun(detectedInputs, restoreConfig)
          : Object.fromEntries(
              detectedInputs.map((input) => [
                input.id,
                defaultParameterConfig(input),
              ]),
            ),
      );

      return detectedInputs;
    },
    [adapter],
  );

  const readInputs = async () => {
    if (!selected) return;
    setError(undefined);
    setBusy(true);

    try {
      await loadInputs(selected);
      setDiagnostics(await adapter.diagnostics(selected));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const setParameterEnabled = (
    id: string,
    enabled: boolean,
  ) => {
    setParameterConfigs((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          enabled: false,
          low: '',
          high: '',
          step: '',
          log: false,
          choices: [],
          conditionParameter: '',
          conditionValues: [],
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
        ...current[id]!,
        [field]: value,
      },
    }));
  };

  const setParameterLog = (id: string, log: boolean) => {
    setParameterConfigs((current) => ({
      ...current,
      [id]: {
        ...current[id]!,
        log,
        ...(log ? { step: '' } : {}),
      },
    }));
  };

  const toggleChoice = (id: string, choice: Primitive) => {
    setParameterConfigs((current) => {
      const config = current[id]!;
      const exists = config.choices.some(
        (value) => value === choice,
      );
      return {
        ...current,
        [id]: {
          ...config,
          choices: exists
            ? config.choices.filter((value) => value !== choice)
            : [...config.choices, choice],
        },
      };
    });
  };

  const setConditionParameter = (
    id: string,
    parameterId: string,
  ) => {
    setParameterConfigs((current) => {
      const parent = current[parameterId];
      return {
        ...current,
        [id]: {
          ...current[id]!,
          conditionParameter: parameterId,
          conditionValues:
            parameterId && parent?.choices.length
              ? [parent.choices[0]!]
              : [],
        },
      };
    });
  };

  const toggleConditionValue = (
    id: string,
    value: Primitive,
  ) => {
    setParameterConfigs((current) => {
      const config = current[id]!;
      const exists = config.conditionValues.some(
        (item) => item === value,
      );

      return {
        ...current,
        [id]: {
          ...config,
          conditionValues: exists
            ? config.conditionValues.filter(
                (item) => item !== value,
              )
            : [...config.conditionValues, value],
        },
      };
    });
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

  const assertRunContext = useCallback(
    async (strategyId: string, config: CreateRun) => {
      const chart = await adapter.getChartContext();

      if (!sameChart(config.chart, chart)) {
        throw new Error(
          'SAFETY: TradingView chart changed. Expected ' +
            config.chart.symbol +
            ' ' +
            config.chart.timeframe +
            ', got ' +
            chart.symbol +
            ' ' +
            chart.timeframe,
        );
      }

      const signature =
        await adapter.getStrategySignature(strategyId);

      const originalParameters = originalParametersRef.current;
      if (originalParameters) {
        const optimisedIds = new Set(
          config.parameters.map((parameter) => parameter.name),
        );
        const liveInputs = await adapter.readStrategyInputs(strategyId);

        for (const input of liveInputs) {
          if (
            optimisedIds.has(input.id) ||
            !(input.id in originalParameters)
          ) {
            continue;
          }

          if (
            JSON.stringify(input.currentValue) !==
            JSON.stringify(originalParameters[input.id])
          ) {
            throw new Error(
              'SAFETY: Fixed strategy input "' +
                input.label +
                '" changed during the optimisation.',
            );
          }
        }
      }

      const backtestMode = await adapter.getBacktestMode();
      const expectedMode = config.backtest_range ? 'deep' : 'chart';
      if (backtestMode !== expectedMode) {
        throw new Error(
          'SAFETY: TradingView backtest mode changed during the optimisation.',
        );
      }

      if (signature !== config.chart.strategy_signature) {
        throw new Error(
          'SAFETY: The TradingView strategy or its input structure changed during the optimisation.',
        );
      }
    },
    [adapter],
  );

  const recoverBackendRun = useCallback(async () => {
    const config = activeConfigRef.current;
    const runId = activeRunIdRef.current;

    if (
      !config ||
      !runId ||
      recoveringBackendRef.current ||
      !connected
    ) {
      return;
    }

    recoveringBackendRef.current = true;

    try {
      await sendRequest({
        type: 'REGISTER_RUN_OWNER',
        payload: { runId },
      });
      await sendRequest({
        type: 'CREATE_RUN',
        payload: config,
      });
      await sendRequest({
        type: 'START_RUN',
        payload: { runId },
      });
    } catch (cause) {
      setError(
        'Could not recover the active optimisation: ' +
          (cause instanceof Error
            ? cause.message
            : String(cause)),
      );
    } finally {
      recoveringBackendRef.current = false;
    }
  }, [connected, sendRequest]);

  const executeTrial = useCallback(
    async (trial: NextTrial) => {
      if (trial.run_id !== activeRunIdRef.current) return;

      if (executingTrialRef.current === trial.trial_number) {
        return;
      }

      if (pendingTrialRef.current?.trial_number === trial.trial_number) {
        return;
      }

      if (executingTrialRef.current !== null) {
        pendingTrialRef.current = trial;
        return;
      }

      const strategyId = activeStrategyIdRef.current;
      const config = activeConfigRef.current;

      if (!strategyId || !config) return;

      executingTrialRef.current = trial.trial_number;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const trialStartedAt = Date.now();

      try {
        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'checking',
        });

        await assertRunContext(strategyId, config);

        const previousSnapshot =
          await adapter.readReportSnapshot(strategyId);

        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'applying',
        });

        await adapter.applyParameters(
          strategyId,
          trial.parameters,
        );

        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'recalculating',
        });

        if (config.backtest_range) {
          const deep = await adapter.configureDeepBacktestRange(
            config.backtest_range.start_date,
            config.backtest_range.end_date,
          );

          if (!deep.supported || !deep.applied) {
            throw new Error(
              deep.reason ??
                'TradingView Deep Backtesting could not be updated',
            );
          }
        }

        let metrics: TradingViewMetrics;
        try {
          metrics = await adapter.waitForMetricsAfterChange(
            strategyId,
            previousSnapshot,
            controller.signal,
          );
        } catch (firstFailure) {
          const firstMessage =
            firstFailure instanceof Error
              ? firstFailure.message
              : String(firstFailure);

          if (
            !/timed out|remained ambiguous/i.test(firstMessage)
          ) {
            throw firstFailure;
          }

          await adapter.ensureStrategyTester();
          const retrySnapshot =
            await adapter.readReportSnapshot(strategyId);
          await adapter.applyParameters(
            strategyId,
            trial.parameters,
          );

          if (config.backtest_range) {
            const retryDeep =
              await adapter.configureDeepBacktestRange(
                config.backtest_range.start_date,
                config.backtest_range.end_date,
              );
            if (
              !retryDeep.supported ||
              !retryDeep.applied
            ) {
              throw new Error(
                retryDeep.reason ??
                  'TradingView Deep Backtesting retry failed',
              );
            }
          }

          metrics =
            await adapter.waitForMetricsAfterChange(
              strategyId,
              retrySnapshot,
              controller.signal,
              35_000,
            );
        }

        await assertRunContext(strategyId, config);

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
            duration_ms: Date.now() - trialStartedAt,
          },
        });
        consecutiveExecutionFailuresRef.current = 0;
      } catch (cause) {
        const aborted =
          cause instanceof DOMException &&
          cause.name === 'AbortError';
        const reason = aborted
          ? 'Trial cancelled by user'
          : cause instanceof Error
            ? cause.message
            : String(cause);

        if (isBackendTransportError(reason)) {
          setError(
            'Backend connection was interrupted. The run is saved and will recover when the backend reconnects.',
          );
        } else if (/not the outstanding trial|unknown run_id/i.test(reason)) {
          // The backend restarted while this browser evaluation was in
          // flight. The recovered backend will issue the correct trial.
        } else {
          const parameterSpecificRuntimeError =
            /strategy runtime error/i.test(reason);
          if (!parameterSpecificRuntimeError && !aborted) {
            consecutiveExecutionFailuresRef.current += 1;
          }

          const fatalIntegrationFailure =
            reason.startsWith('SAFETY:') ||
            /deep backtesting.*(could not|not available|failed)|could not open tradingview strategy tester/i.test(
              reason,
            ) ||
            consecutiveExecutionFailuresRef.current >= 3;

          try {
            if (fatalIntegrationFailure) {
              await sendRequest({
                type: 'STOP_RUN',
                payload: { runId: trial.run_id },
              });
            }

            await sendRequest({
              type: 'TRIAL_FAILED',
              payload: {
                runId: trial.run_id,
                trialNumber: trial.trial_number,
                reason,
              },
            });
          } catch (failureCause) {
            const failureMessage =
              failureCause instanceof Error
                ? failureCause.message
                : String(failureCause);

            if (!/not the outstanding trial/i.test(failureMessage)) {
              setError(failureMessage);
            }
          }

          if (!aborted) setError(reason);
        }
      } finally {
        if (
          executingTrialRef.current === trial.trial_number
        ) {
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
    [adapter, assertRunContext, sendRequest],
  );

  const prepareDateRange = async (
    strategyId: string,
    config: CreateRun,
  ) => {
    if (!config.backtest_range) return;

    const before = await adapter.readReportSnapshot(strategyId);
    const result = await adapter.configureDeepBacktestRange(
      config.backtest_range.start_date,
      config.backtest_range.end_date,
    );

    if (!result.supported || !result.applied) {
      throw new Error(
        result.reason ??
          'Could not configure TradingView Deep Backtesting',
      );
    }

    await adapter.waitForMetricsAfterChange(
      strategyId,
      before,
      undefined,
      30_000,
    );
  };

  const startOptimisation = async () => {
    if (!selected) return;

    setError(undefined);
    setBusy(true);
    setStopChoiceVisible(false);

    try {
      if (!connected) {
        throw new Error(
          pairingRequired
            ? 'Pair the extension with the backend first'
            : 'Start the local FastAPI backend before optimising',
        );
      }

      const strategy = strategies.find(
        (item) => item.id === selected,
      );
      if (!strategy) {
        throw new Error(
          'Selected strategy is no longer available',
        );
      }

      const parameters = buildSearchSpace(
        inputs,
        parameterConfigs,
      );
      const baselineParameters =
        buildBaselineParameters(inputs, parameters);
      const filters = buildFilters();
      const trials = numberOrThrow(
        targetTrials,
        'Number of trials',
      );

      if (
        !Number.isInteger(trials) ||
        trials < 1 ||
        trials > 100_000
      ) {
        throw new Error(
          'Number of trials must be an integer between 1 and 100,000',
        );
      }

      let backtestRange: CreateRun['backtest_range'] = null;
      if (dateRangeEnabled) {
        if (!startDate || !endDate) {
          throw new Error(
            'Choose both Deep Backtesting dates',
          );
        }
        if (startDate >= endDate) {
          throw new Error(
            'Backtest start date must be before the end date',
          );
        }
        backtestRange = {
          mode: 'deep',
          start_date: startDate,
          end_date: endDate,
        };
      }

      const metric = metricDefinition(objectiveMetric);
      const chart = await adapter.getChartContext();
      const strategySignature =
        await adapter.getStrategySignature(selected);

      await adapter.ensureStrategyTester();

      if (!backtestRange) {
        await adapter.resetToChartSession();
      }

      const config: CreateRun = {
        run_id: crypto.randomUUID(),
        objective_metric: objectiveMetric,
        direction: metric.direction,
        target_trials: trials,
        parameters,
        filters,
        chart: {
          symbol: chart.symbol,
          timeframe: chart.timeframe,
          strategy_name: strategy.name,
          strategy_signature: strategySignature,
        },
        backtest_range: backtestRange,
        baseline_parameters: baselineParameters,
      };

      await prepareDateRange(selected, config);

      const initialMetrics =
        await adapter.waitForMetricsAfterChange(
          selected,
          null,
          undefined,
          12_000,
        );

      const requiredMetrics = [
        objectiveMetric,
        ...filters.map((filter) => filter.metric),
      ];

      if ((initialMetrics.totalTrades ?? 0) > 0) {
        for (const requiredMetric of requiredMetrics) {
          if (
            requiredMetric !== 'profitFactor' &&
            !Number.isFinite(initialMetrics[requiredMetric])
          ) {
            throw new Error(
              'TradingView did not expose the required metric: ' +
                metricDefinition(requiredMetric).label,
            );
          }
        }
      }

      const originalParameters = Object.fromEntries(
        inputs.map((input) => [
          input.id,
          input.currentValue,
        ]),
      );

      const now = Date.now();
      const persisted: PersistedOptimisationRun = {
        version: 1,
        config,
        strategyId: selected,
        originalParameters,
        startedAt: now,
      };

      await saveActiveRun(persisted);

      activeRunIdRef.current = config.run_id;
      activeStrategyIdRef.current = selected;
      activeConfigRef.current = config;
      runChartRef.current = chart;
      originalParametersRef.current =
        originalParameters;
      pendingTrialRef.current = null;
      consecutiveExecutionFailuresRef.current = 0;

      setRunConfig(config);
      setStartedAt(now);
      setFinishedAt(null);
      setActiveRunId(config.run_id);
      setProgress(null);
      setCurrentTrial(null);
      setResumeCandidate(null);

      await sendRequest({
        type: 'CREATE_RUN',
        payload: config,
      });
      await sendRequest({
        type: 'START_RUN',
        payload: { runId: config.run_id },
      });
    } catch (cause) {
      await clearActiveRun();
      activeRunIdRef.current = null;
      activeConfigRef.current = null;
      setActiveRunId(null);
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const resumeOptimisation = async () => {
    const candidate = resumeCandidate;
    if (!candidate) return;

    setBusy(true);
    setError(undefined);
    setStopChoiceVisible(false);

    try {
      if (!connected) {
        throw new Error(
          pairingRequired
            ? 'Pair the extension with the backend first'
            : 'Start the backend before resuming',
        );
      }

      const chart = await adapter.getChartContext();
      if (!sameChart(candidate.config.chart, chart)) {
        throw new Error(
          'The current TradingView symbol/timeframe does not match the saved optimisation.',
        );
      }

      const detected = await adapter.detectStrategies();
      let matchingStrategy: DetectedStrategy | null = null;

      for (const strategy of detected) {
        if (
          strategy.name !==
          candidate.config.chart.strategy_name
        ) {
          continue;
        }

        const signature =
          await adapter.getStrategySignature(strategy.id);

        if (
          signature ===
          candidate.config.chart.strategy_signature
        ) {
          matchingStrategy = strategy;
          break;
        }
      }

      if (!matchingStrategy) {
        throw new Error(
          'The saved strategy version/input structure is not present on the current chart.',
        );
      }

      setStrategies(detected);
      setSelected(matchingStrategy.id);
      await loadInputs(
        matchingStrategy.id,
        candidate.config,
      );
      await adapter.ensureStrategyTester();
      if (candidate.config.backtest_range) {
        await prepareDateRange(
          matchingStrategy.id,
          candidate.config,
        );
      } else {
        await adapter.resetToChartSession();
      }

      activeRunIdRef.current =
        candidate.config.run_id;
      activeStrategyIdRef.current =
        matchingStrategy.id;
      activeConfigRef.current = candidate.config;
      runChartRef.current = chart;
      originalParametersRef.current =
        candidate.originalParameters;
      pendingTrialRef.current = null;
      consecutiveExecutionFailuresRef.current = 0;

      setRunConfig(candidate.config);
      setProgress(candidate.lastProgress ?? null);
      setStartedAt(candidate.startedAt);
      setFinishedAt(null);
      setActiveRunId(candidate.config.run_id);
      setResumeCandidate(null);

      await saveActiveRun({
        ...candidate,
        strategyId: matchingStrategy.id,
      });

      await sendRequest({
        type: 'REGISTER_RUN_OWNER',
        payload: { runId: candidate.config.run_id },
      });
      await sendRequest({
        type: 'CREATE_RUN',
        payload: candidate.config,
      });
      await sendRequest({
        type: 'START_RUN',
        payload: { runId: candidate.config.run_id },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const discardResumeCandidate = async () => {
    await clearActiveRun();
    setResumeCandidate(null);
    setProgress(null);
    setRunConfig(null);
    setStartedAt(null);
  };

  const stopOptimisation = async () => {
    const runId = activeRunIdRef.current;
    if (!runId) return;

    setError(undefined);
    pendingTrialRef.current = null;

    try {
      await sendRequest({
        type: 'STOP_RUN',
        payload: { runId },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      abortControllerRef.current?.abort();
    }
  };

  const applyParameters = async (
    parameters: Record<string, unknown>,
  ) => {
    const strategyId =
      activeStrategyIdRef.current || selected;

    if (!strategyId) {
      throw new Error('No TradingView strategy is selected');
    }

    await adapter.applyParameters(
      strategyId,
      parameters,
    );
  };

  const applyBestParameters = async () => {
    if (!progress?.best) return;
    setBusy(true);
    setError(undefined);

    try {
      await applyParameters(progress.best.parameters);
      setStopChoiceVisible(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreOriginalParameters = async () => {
    if (!originalParametersRef.current) return;

    setBusy(true);
    setError(undefined);

    try {
      await applyParameters(
        originalParametersRef.current,
      );
      setStopChoiceVisible(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const pairBackend = async () => {
    if (!pairingCode.trim()) return;

    setBusy(true);
    setError(undefined);

    try {
      const state = await sendRequest<BackendState>({
        type: 'PAIR_BACKEND',
        payload: { code: pairingCode.trim() },
      });
      applyBackendState(state);
      setPairingCode('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const exportRun = async (format: 'csv' | 'json') => {
    if (!runConfig || !progress) return;

    const base =
      safeFilename(runConfig.chart.strategy_name) +
      '-' +
      runConfig.run_id.slice(0, 8);

    const isCsv = format === 'csv';
    const fileContent = isCsv
      ? buildTrialsCsv(runConfig, progress)
      : buildRunJson(runConfig, progress);

    await sendRequest({
      type: 'EXPORT_RESULTS',
      payload: {
        filename: base + '.' + format,
        mimeType: isCsv
          ? 'text/csv'
          : 'application/json',
        content: fileContent,
      },
    });
  };

  useEffect(() => {
    void probe();

    const initialise = async () => {
      const state = await sendRequest<BackendState>({
        type: 'GET_BACKEND_STATE',
      });
      applyBackendState(state);

      if (!state.connected && !state.pairingRequired) {
        const connectState =
          await sendRequest<BackendState>({
            type: 'BACKEND_CONNECT',
          });
        applyBackendState(connectState);
      }

      const saved = await loadActiveRun();
      if (saved) {
        setResumeCandidate(saved);
        setProgress(saved.lastProgress ?? null);
        setRunConfig(saved.config);
        setStartedAt(saved.startedAt);
        setFinishedAt(null);
        originalParametersRef.current =
          saved.originalParameters;
      } else {
        const last = await loadLastRun();
        if (last?.lastProgress) {
          setProgress(last.lastProgress);
          setRunConfig(last.config);
          setStartedAt(last.startedAt);
          setFinishedAt(last.finishedAt ?? null);
          originalParametersRef.current =
            last.originalParameters;
        }
      }
    };

    void initialise().catch((cause) => {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    });
  }, [applyBackendState, probe, sendRequest]);

  useEffect(() => {
    const listener = (message: BackgroundMessage) => {
      if (message.type === 'BACKEND_STATE') {
        const previouslyConnected = wasConnectedRef.current;
        wasConnectedRef.current = message.connected;
        applyBackendState(message);

        if (
          message.connected &&
          !previouslyConnected &&
          activeRunIdRef.current
        ) {
          queueMicrotask(() => {
            void recoverBackendRun();
          });
        }
        return;
      }

      if (message.type === 'BACKEND_ERROR') {
        setError(message.message);
        return;
      }

      if (message.type === 'RUN_PROGRESS') {
        if (
          message.progress.run_id !==
          activeRunIdRef.current
        ) {
          return;
        }

        setProgress(message.progress);
        void updateActiveRunProgress(message.progress);

        if (
          message.progress.status === 'completed' ||
          message.progress.status === 'stopped' ||
          message.progress.status === 'failed'
        ) {
          const finishedRunId =
            message.progress.run_id;

          activeRunIdRef.current = null;
          pendingTrialRef.current = null;
          setFinishedAt(Date.now());
          setActiveRunId(null);
          setCurrentTrial(null);

          if (message.progress.status === 'stopped') {
            setStopChoiceVisible(true);
          }

          void finishActiveRun(message.progress);
          void sendRequest({
            type: 'CLEAR_RUN_OWNER',
            payload: { runId: finishedRunId },
          });
        }
        return;
      }

      if (message.type === 'NEXT_TRIAL') {
        void executeTrial(message.trial);
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () =>
      browser.runtime.onMessage.removeListener(listener);
  }, [
    applyBackendState,
    executeTrial,
    recoverBackendRun,
    sendRequest,
  ]);

  useEffect(() => {
    if (activeRunId === null) return;

    const timer = setInterval(() => {
      setClock(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [activeRunId]);

  const optimisableInputs = inputs.filter(
    isOptimisableInput,
  );
  const selectedInputCount = optimisableInputs.filter(
    (input) => parameterConfigs[input.id]?.enabled,
  ).length;

  const objective = metricDefinition(
    runConfig?.objective_metric ?? objectiveMetric,
  );

  const completion =
    progress && progress.target_trials > 0
      ? Math.min(
          100,
          (progress.completed_trials /
            progress.target_trials) *
            100,
        )
      : 0;

  const selectedTrial: TrialSummary | null =
    selectedTrialNumber === null
      ? null
      : progress?.trials.find(
          (trial) =>
            trial.trial_number === selectedTrialNumber,
        ) ?? null;

  const displayedTrials = progress
    ? sortTrials(
        filterTrials(progress.trials, trialFilter),
        trialSort,
        runConfig?.direction ?? 'maximize',
      )
    : [];

  const graphPoints = progress
    ? bestSoFar(
        progress.trials,
        runConfig?.direction ?? 'maximize',
      )
    : [];

  const eta = progress
    ? estimateRemainingMs(
        progress.trials,
        progress.completed_trials,
        progress.target_trials,
      )
    : null;

  const elapsed =
    startedAt === null
      ? null
      : (activeRunId !== null
          ? clock
          : finishedAt ?? clock) - startedAt;

  const inputLabel = (id: string): string =>
    inputs.find((input) => input.id === id)?.label ??
    id;

  return (
    <main className="panel">
      <header data-drag-handle title="Drag optimiser">
        <div>
          <div className="eyebrow">TRADINGVIEW</div>
          <h1>Optuna Optimiser</h1>
        </div>
        <span
          className={
            connected ? 'status connected' : 'status'
          }
        >
          {connected
            ? 'Optuna ' +
              (optunaVersion ?? 'connected')
            : pairingRequired
              ? 'Pair backend'
              : 'Backend offline'}
        </span>
      </header>

      {pairingRequired && (
        <section className="pairingCard">
          <strong>Pair local backend</strong>
          <p className="helpText">
            Enter the pairing code printed in the backend
            terminal.
          </p>
          <div className="inlineForm">
            <input
              value={pairingCode}
              placeholder="Pairing code"
              autoComplete="off"
              onChange={(event) =>
                setPairingCode(event.target.value)
              }
            />
            <button
              className="primary compactButton"
              disabled={busy || !pairingCode.trim()}
              onClick={() => void pairBackend()}
            >
              Pair
            </button>
          </div>
        </section>
      )}

      {resumeCandidate && activeRunId === null && (
        <section className="resumeCard">
          <strong>Unfinished optimisation found</strong>
          <p className="helpText">
            {resumeCandidate.config.chart.strategy_name} ·{' '}
            {resumeCandidate.lastProgress?.completed_trials ??
              0}
            /
            {resumeCandidate.config.target_trials} trials
          </p>
          <div className="buttonRow twoButtons">
            <button
              className="primary"
              disabled={busy || !connected}
              onClick={() =>
                void resumeOptimisation()
              }
            >
              Resume
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void discardResumeCandidate()
              }
            >
              Discard
            </button>
          </div>
        </section>
      )}

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
            setDiagnostics(null);
            setProgress(null);
            setRunConfig(null);
          }}
        >
          <option value="">Select strategy…</option>
          {strategies.map((strategy) => (
            <option
              key={strategy.id}
              value={strategy.id}
            >
              {strategy.name}
            </option>
          ))}
        </select>

        <div className="buttonRow twoButtons">
          <button
            className="secondary"
            disabled={
              !selected ||
              busy ||
              activeRunId !== null
            }
            onClick={() => void readInputs()}
          >
            {inputs.length > 0
              ? 'Reload inputs'
              : 'Read inputs'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void runDiagnostics()
            }
          >
            Diagnostics
          </button>
        </div>
      </section>

      {diagnosticsOpen && diagnostics && (
        <section>
          <div className="rowLabel">
            <strong>Compatibility</strong>
            <button
              className="textButton"
              onClick={() =>
                setDiagnosticsOpen(false)
              }
            >
              Hide
            </button>
          </div>

          <div className="diagnosticList">
            {diagnostics.checks.map((check) => (
              <div
                className="diagnosticRow"
                key={check.id}
              >
                <span
                  className={
                    check.ok
                      ? 'diagnosticDot ok'
                      : 'diagnosticDot bad'
                  }
                />
                <div>
                  <strong>{check.label}</strong>
                  {check.detail && (
                    <small>{check.detail}</small>
                  )}
                </div>
              </div>
            ))}

            <div className="diagnosticRow">
              <span
                className={
                  diagnostics.deepBacktesting.available
                    ? 'diagnosticDot ok'
                    : 'diagnosticDot neutral'
                }
              />
              <div>
                <strong>Deep Backtesting</strong>
                <small>
                  {diagnostics.deepBacktesting.available
                    ? 'Available'
                    : diagnostics.deepBacktesting.reason}
                </small>
              </div>
            </div>
          </div>
        </section>
      )}

      {inputs.length > 0 && (
        <>
          <section>
            <div className="rowLabel">
              <strong>Parameters</strong>
              <span className="muted">
                {selectedInputCount}/
                {optimisableInputs.length} selected
              </span>
            </div>

            <div className="parameterList">
              {optimisableInputs.map((input) => {
                const config =
                  parameterConfigs[input.id]!;
                const enabled =
                  config?.enabled ?? false;
                const numeric =
                  input.type === 'integer' ||
                  input.type === 'float';
                const categorical =
                  input.type === 'boolean' ||
                  input.type === 'categorical';
                const conditionCandidates =
                  conditionCandidatesFor(
                    input.id,
                    inputs,
                    parameterConfigs,
                  );
                const parent =
                  conditionCandidates.find(
                    (candidate) =>
                      candidate.id ===
                      config.conditionParameter,
                  );
                const parentChoices = parent
                  ? parameterConfigs[parent.id]
                      ?.choices ?? []
                  : [];

                return (
                  <div
                    className={
                      'parameterCard' +
                      (enabled
                        ? ' parameterCardEnabled'
                        : '')
                    }
                    key={input.id}
                  >
                    <label className="parameterHeading">
                      <input
                        type="checkbox"
                        disabled={
                          activeRunId !== null
                        }
                        checked={enabled}
                        onChange={(event) =>
                          setParameterEnabled(
                            input.id,
                            event.target.checked,
                          )
                        }
                      />
                      <span className="parameterName">
                        <strong>{input.label}</strong>
                        <small>
                          {input.type} · current{' '}
                          {String(input.currentValue)}
                        </small>
                      </span>
                    </label>

                    {enabled && numeric && (
                      <>
                        <div className="rangeGrid">
                          <label>
                            <span>Min</span>
                            <input
                              type="number"
                              value={config.low}
                              disabled={
                                activeRunId !== null
                              }
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
                              value={config.high}
                              disabled={
                                activeRunId !== null
                              }
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
                              value={config.step}
                              disabled={
                                activeRunId !== null ||
                                config.log
                              }
                              placeholder={
                                input.type === 'integer'
                                  ? '1'
                                  : 'auto'
                              }
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

                        <label className="advancedToggle">
                          <input
                            type="checkbox"
                            checked={config.log}
                            disabled={
                              activeRunId !== null
                            }
                            onChange={(event) =>
                              setParameterLog(
                                input.id,
                                event.target.checked,
                              )
                            }
                          />
                          Logarithmic search
                        </label>
                      </>
                    )}

                    {enabled && categorical && (
                      <div className="choiceList">
                        {(
                          input.type === 'boolean'
                            ? [false, true]
                            : (input.options ?? []).filter(
                                (value): value is Primitive =>
                                  typeof value ===
                                    'string' ||
                                  typeof value ===
                                    'number' ||
                                  typeof value ===
                                    'boolean',
                              )
                        ).map((choice) => (
                          <label
                            className="choiceChip"
                            key={String(choice)}
                          >
                            <input
                              type="checkbox"
                              disabled={
                                activeRunId !== null
                              }
                              checked={config.choices.some(
                                (value) =>
                                  value === choice,
                              )}
                              onChange={() =>
                                toggleChoice(
                                  input.id,
                                  choice,
                                )
                              }
                            />
                            {String(choice)}
                          </label>
                        ))}
                      </div>
                    )}

                    {enabled &&
                      conditionCandidates.length > 0 && (
                        <div className="conditionBlock">
                          <label>
                            <span>Only optimise when</span>
                            <select
                              value={
                                config.conditionParameter
                              }
                              disabled={
                                activeRunId !== null
                              }
                              onChange={(event) =>
                                setConditionParameter(
                                  input.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">
                                Always
                              </option>
                              {conditionCandidates.map(
                                (candidate) => (
                                  <option
                                    key={candidate.id}
                                    value={
                                      candidate.id
                                    }
                                  >
                                    {candidate.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>

                          {config.conditionParameter &&
                            parentChoices.length >
                              0 && (
                              <div className="choiceList compactChoices">
                                {parentChoices.map(
                                  (choice) => (
                                    <label
                                      className="choiceChip"
                                      key={String(
                                        choice,
                                      )}
                                    >
                                      <input
                                        type="checkbox"
                                        disabled={
                                          activeRunId !==
                                          null
                                        }
                                        checked={config.conditionValues.some(
                                          (value) =>
                                            value ===
                                            choice,
                                        )}
                                        onChange={() =>
                                          toggleConditionValue(
                                            input.id,
                                            choice,
                                          )
                                        }
                                      />
                                      {String(choice)}
                                    </label>
                                  ),
                                )}
                              </div>
                            )}
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
                    setObjectiveMetric(
                      event.target.value,
                    )
                  }
                >
                  {OPTIMISATION_METRICS.map(
                    (metric) => (
                      <option
                        key={metric.key}
                        value={metric.key}
                      >
                        {metric.label}
                      </option>
                    ),
                  )}
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
                  onChange={(event) =>
                    setTargetTrials(
                      event.target.value,
                    )
                  }
                />
              </label>
            </div>

            <div className="subsection">
              <label className="toggleRow">
                <input
                  type="checkbox"
                  checked={dateRangeEnabled}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setDateRangeEnabled(
                      event.target.checked,
                    )
                  }
                />
                <span>
                  Custom Deep Backtesting range
                </span>
              </label>

              {dateRangeEnabled && (
                <div className="dateGrid">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={startDate}
                      disabled={
                        activeRunId !== null
                      }
                      onChange={(event) =>
                        setStartDate(
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={endDate}
                      disabled={
                        activeRunId !== null
                      }
                      onChange={(event) =>
                        setEndDate(
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="filterList">
              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={
                    maxDrawdownFilter.enabled
                  }
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMaxDrawdownFilter(
                      (current) => ({
                        ...current,
                        enabled:
                          event.target.checked,
                      }),
                    )
                  }
                />
                <span>Max drawdown %</span>
                <input
                  type="number"
                  value={maxDrawdownFilter.value}
                  disabled={
                    !maxDrawdownFilter.enabled ||
                    activeRunId !== null
                  }
                  onChange={(event) =>
                    setMaxDrawdownFilter(
                      (current) => ({
                        ...current,
                        value: event.target.value,
                      }),
                    )
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={
                    minProfitFactorFilter.enabled
                  }
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMinProfitFactorFilter(
                      (current) => ({
                        ...current,
                        enabled:
                          event.target.checked,
                      }),
                    )
                  }
                />
                <span>Min profit factor</span>
                <input
                  type="number"
                  step="0.01"
                  value={
                    minProfitFactorFilter.value
                  }
                  disabled={
                    !minProfitFactorFilter.enabled ||
                    activeRunId !== null
                  }
                  onChange={(event) =>
                    setMinProfitFactorFilter(
                      (current) => ({
                        ...current,
                        value: event.target.value,
                      }),
                    )
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={minTradesFilter.enabled}
                  disabled={activeRunId !== null}
                  onChange={(event) =>
                    setMinTradesFilter(
                      (current) => ({
                        ...current,
                        enabled:
                          event.target.checked,
                      }),
                    )
                  }
                />
                <span>Min trades</span>
                <input
                  type="number"
                  value={minTradesFilter.value}
                  disabled={
                    !minTradesFilter.enabled ||
                    activeRunId !== null
                  }
                  onChange={(event) =>
                    setMinTradesFilter(
                      (current) => ({
                        ...current,
                        value: event.target.value,
                      }),
                    )
                  }
                />
              </label>
            </div>

            {activeRunId === null ? (
              <button
                className="primary"
                disabled={
                  !connected ||
                  busy ||
                  selectedInputCount === 0
                }
                onClick={() =>
                  void startOptimisation()
                }
              >
                {busy
                  ? 'Preparing…'
                  : 'Start optimisation'}
              </button>
            ) : (
              <button
                className="danger"
                onClick={() =>
                  void stopOptimisation()
                }
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
              {progress?.target_trials ??
                targetTrials}
            </span>
          </div>

          <div className="progressTrack">
            <div
              className="progressFill"
              style={{
                width: completion + '%',
              }}
            />
          </div>

          <div className="runTiming">
            <span>
              Elapsed {formatDuration(elapsed)}
            </span>
            <span>
              ETA {formatDuration(eta)}
            </span>
          </div>

          {currentTrial && (
            <div className="currentTrial">
              Trial #{currentTrial.number} ·{' '}
              {currentTrial.phase === 'checking'
                ? 'checking chart'
                : currentTrial.phase ===
                    'applying'
                  ? 'applying parameters'
                  : currentTrial.phase ===
                      'recalculating'
                    ? 'waiting for TradingView'
                    : 'submitting result'}
            </div>
          )}

          {graphPoints.length >= 2 && (
            <BestSoFarChart points={graphPoints} />
          )}

          {progress?.best && (
            <div className="bestCard">
              <div className="rowLabel">
                <strong>Best feasible result</strong>
                <span className="bestValue">
                  {objective.label}{' '}
                  {formatMetric(
                    objective.key,
                    progress.best
                      .objective_value,
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
                      Number.isFinite(
                        progress.best!.metrics[
                          key
                        ],
                      ),
                  )
                  .map((key) => (
                    <div key={key}>
                      <span>
                        {
                          metricDefinition(key)
                            .label
                        }
                      </span>
                      <strong>
                        {formatMetric(
                          key,
                          progress.best!.metrics[
                            key
                          ]!,
                        )}
                      </strong>
                    </div>
                  ))}
              </div>

              <div className="bestParameters">
                {Object.entries(
                  progress.best.parameters,
                ).map(([id, value]) => (
                  <div key={id}>
                    <span>
                      {inputLabel(id)}
                    </span>
                    <code>{String(value)}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {progress &&
            progress.trials.length > 0 && (
              <>
                <div className="trialToolbar">
                  <select
                    value={trialFilter}
                    onChange={(event) =>
                      setTrialFilter(
                        event.target
                          .value as TrialFilter,
                      )
                    }
                  >
                    <option value="all">
                      All trials
                    </option>
                    <option value="valid">
                      Valid
                    </option>
                    <option value="filtered">
                      Filtered
                    </option>
                    <option value="failed">
                      Failed
                    </option>
                  </select>

                  <select
                    value={trialSort}
                    onChange={(event) =>
                      setTrialSort(
                        event.target
                          .value as TrialSort,
                      )
                    }
                  >
                    <option value="trial-desc">
                      Newest
                    </option>
                    <option value="trial-asc">
                      Oldest
                    </option>
                    <option value="objective-best">
                      Best objective
                    </option>
                    <option value="objective-worst">
                      Worst objective
                    </option>
                    <option value="duration">
                      Slowest
                    </option>
                  </select>
                </div>

                <div className="trialList">
                  {displayedTrials.map(
                    (trial) => {
                      const feasible =
                        isFeasibleTrial(trial);

                      return (
                        <button
                          className={
                            'trialRow trialButton' +
                            (selectedTrialNumber ===
                            trial.trial_number
                              ? ' selectedTrial'
                              : '')
                          }
                          key={trial.trial_number}
                          onClick={() =>
                            setSelectedTrialNumber(
                              trial.trial_number,
                            )
                          }
                        >
                          <span>
                            #{trial.trial_number}
                          </span>
                          <strong>
                            {trial.objective_value ===
                            null
                              ? 'Failed'
                              : formatMetric(
                                  objective.key,
                                  trial.objective_value,
                                )}
                          </strong>
                          <span
                            className={
                              trial.state ===
                              'failed'
                                ? 'trialState failed'
                                : feasible
                                  ? 'trialState feasible'
                                  : 'trialState constrained'
                            }
                          >
                            {trial.state ===
                            'failed'
                              ? 'failed'
                              : feasible
                                ? 'valid'
                                : 'filtered'}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </>
            )}

          {selectedTrial && (
            <div className="trialDetail">
              <div className="rowLabel">
                <strong>
                  Trial #
                  {selectedTrial.trial_number}
                </strong>
                <button
                  className="textButton"
                  onClick={() =>
                    setSelectedTrialNumber(
                      null,
                    )
                  }
                >
                  Close
                </button>
              </div>

              {selectedTrial.failure_reason && (
                <div className="detailError">
                  {
                    selectedTrial.failure_reason
                  }
                </div>
              )}

              <h3>Parameters</h3>
              <div className="metricsList">
                {Object.entries(
                  selectedTrial.parameters,
                ).map(([key, value]) => (
                  <div key={key}>
                    <span>
                      {inputLabel(key)}
                    </span>
                    <code>{String(value)}</code>
                  </div>
                ))}
              </div>

              <h3>Constraints</h3>
              <div className="metricsList">
                {Object.entries(
                  selectedTrial.constraints,
                ).length === 0 ? (
                  <div>
                    <span>No constraints</span>
                    <code>—</code>
                  </div>
                ) : (
                  Object.entries(
                    selectedTrial.constraints,
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>
                        {value <= 0
                          ? 'pass'
                          : 'fail (' +
                            value.toFixed(
                              4,
                            ) +
                            ')'}
                      </code>
                    </div>
                  ))
                )}
              </div>

              <h3>
                Full TradingView metrics
              </h3>
              <div className="metricsList fullMetrics">
                {Object.entries(
                  selectedTrial.metrics,
                )
                  .sort(([a], [b]) =>
                    a.localeCompare(b),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <code>
                        {formatMetric(
                          key,
                          value,
                        )}
                      </code>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {progress && runConfig && (
            <div className="exportRow">
              <button
                className="secondary"
                onClick={() =>
                  void exportRun('csv')
                }
              >
                Export CSV
              </button>
              <button
                className="secondary"
                onClick={() =>
                  void exportRun('json')
                }
              >
                Export JSON
              </button>
            </div>
          )}
        </section>
      )}

      {stopChoiceVisible && (
        <section className="stopChoice">
          <strong>Optimisation stopped</strong>
          <p className="helpText">
            Choose which parameters TradingView should
            keep.
          </p>
          <div className="stackedButtons">
            <button
              className="primary"
              disabled={!progress?.best || busy}
              onClick={() =>
                void applyBestParameters()
              }
            >
              Apply best parameters
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void restoreOriginalParameters()
              }
            >
              Restore original parameters
            </button>
            <button
              className="textButton"
              onClick={() =>
                setStopChoiceVisible(false)
              }
            >
              Keep current parameters
            </button>
          </div>
        </section>
      )}

      {progress?.best &&
        activeRunId === null &&
        !stopChoiceVisible && (
          <section>
            <div className="buttonRow twoButtons">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void applyBestParameters()
                }
              >
                Apply best
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void restoreOriginalParameters()
                }
              >
                Restore original
              </button>
            </div>
          </section>
        )}

      {error && (
        <div className="error">{error}</div>
      )}
    </main>
  );
}
