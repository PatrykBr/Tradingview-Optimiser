import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  deleteStrategyPreset,
  loadStrategyPresets,
  saveStrategyPreset,
  type SavedOptimisationPreset,
} from '../../lib/optimisation/presets';
import {
  applyParameterConfigEdit,
  conditionCandidatesFor,
  createParameterConfigs,
  isOptimisableInput,
  reconcileParameterConfigs,
  type ParameterConfig,
  type ParameterConfigEdit,
} from '../../lib/optimisation/parameter-config';
import {
  buildBaselineParameters,
  buildSearchSpace,
} from '../../lib/optimisation/search-space';
import { metricDefinition } from '../../lib/optimisation/metrics';
import type {
  CreateRun,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import type {
  DetectedStrategy,
  StrategyInput,
  TradingViewDiagnostics,
} from '../../lib/tradingview/types';
import type { PersistedOptimisationRun } from '../../lib/optimisation/storage';
import { cloneOptimisationDraft } from '../../lib/optimisation/draft';
import {
  buildMetricFilters,
  buildResearchPlan,
  DEFAULT_OPTIMISATION_FORM,
  formFromRun,
  parameterConfigsFromRun,
  parseTargetTrials,
  sameChart,
  type FilterConfig,
  type OptimisationForm,
} from '../../lib/optimisation/run-config';

export interface PreparedOptimisationRun {
  config: CreateRun;
  strategyId: string;
  originalParameters: Record<string, unknown>;
}

type ErrorSetter = Dispatch<SetStateAction<string | undefined>>;

const prepareTradingViewRun = async (
  adapter: TradingViewAdapter,
  strategyId: string,
  config: CreateRun,
  inputs: StrategyInput[],
): Promise<PreparedOptimisationRun> => {
  const range = config.backtest_range;

  await adapter.prepareBacktest(
    strategyId,
    range
      ? {
          startDate: range.start_date,
          endDate: range.end_date,
        }
      : null,
  );

  const initialMetrics =
    await adapter.waitForMetricsAfterChange(
      strategyId,
      null,
      undefined,
      12_000,
    );
  const requiredMetrics = [
    config.objective_metric,
    ...config.filters.map(
      (filter) => filter.metric,
    ),
  ];

  if ((initialMetrics.totalTrades ?? 0) > 0) {
    for (const requiredMetric of requiredMetrics) {
      if (
        requiredMetric !== 'profitFactor' &&
        !Number.isFinite(
          initialMetrics[requiredMetric],
        )
      ) {
        throw new Error(
          'TradingView did not expose the required metric: ' +
            metricDefinition(requiredMetric).label,
        );
      }
    }
  }

  const settingsSignature =
    await adapter.getStrategySettingsSignature(
      strategyId,
    );

  return {
    config: {
      ...config,
      chart: {
        ...config.chart,
        strategy_settings_signature:
          settingsSignature,
      },
    },
    strategyId,
    originalParameters:
      Object.fromEntries(
        inputs.map((input) => [
          input.id,
          input.currentValue,
        ]),
      ),
  };
};

export function useStrategyConfiguration(
  adapter: TradingViewAdapter,
  setError: ErrorSetter,
) {
  const [strategies, setStrategies] = useState<DetectedStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const selectedStrategyIdRef = useRef('');
  const [inputs, setInputs] = useState<StrategyInput[]>([]);
  const [parameterConfigs, setParameterConfigs] = useState<
    Record<string, ParameterConfig>
  >({});
  const [form, setForm] = useState<OptimisationForm>(
    DEFAULT_OPTIMISATION_FORM,
  );

  const [currentStrategySignature, setCurrentStrategySignature] =
    useState<string>();
  const [savedPresets, setSavedPresets] = useState<
    SavedOptimisationPreset[]
  >([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');

  const [diagnostics, setDiagnostics] =
    useState<TradingViewDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const clearLoadedStrategy = useCallback(() => {
    setInputs([]);
    setParameterConfigs({});
    setCurrentStrategySignature(undefined);
    setSavedPresets([]);
    setSelectedPresetId('');
    setPresetName('');
    setDiagnostics(null);
    setDiagnosticsOpen(false);
  }, []);

  const probe = useCallback(async () => {
    setError(undefined);

    try {
      const detected = await adapter.detectStrategies();
      setStrategies(detected);

      const currentSelection =
        selectedStrategyIdRef.current;
      const soleStrategy =
        detected.length === 1
          ? detected[0]
          : undefined;
      const nextSelected =
        soleStrategy?.id ??
        (detected.some(
          (strategy) =>
            strategy.id === currentSelection,
        )
          ? currentSelection
          : '');

      if (nextSelected !== currentSelection) {
        clearLoadedStrategy();
      }
      selectedStrategyIdRef.current =
        nextSelected;
      setSelectedStrategyId(nextSelected);

      if (detected.length === 0) {
        setError(
          'No Pine strategies found on the current TradingView chart.',
        );
      }
    } catch (cause) {
      setStrategies([]);
      selectedStrategyIdRef.current = '';
      setSelectedStrategyId('');
      clearLoadedStrategy();
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }, [
    adapter,
    clearLoadedStrategy,
    setError,
  ]);

  const refreshStrategyPresets = useCallback(
    async (strategyId: string): Promise<string> => {
      const signature =
        await adapter.getStrategySignature(strategyId);
      const presets = await loadStrategyPresets(signature);

      setCurrentStrategySignature(signature);
      setSavedPresets(presets);
      setSelectedPresetId((current) =>
        presets.some((preset) => preset.id === current)
          ? current
          : '',
      );

      return signature;
    },
    [adapter],
  );

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
          ? parameterConfigsFromRun(
              detectedInputs,
              restoreConfig,
            )
          : createParameterConfigs(detectedInputs),
      );

      if (restoreConfig) {
        setForm(formFromRun(restoreConfig));
      }

      return detectedInputs;
    },
    [adapter],
  );

  const selectStrategy = useCallback(
    (strategyId: string) => {
      selectedStrategyIdRef.current =
        strategyId;
      setSelectedStrategyId(strategyId);
      clearLoadedStrategy();
    },
    [clearLoadedStrategy],
  );

  const readInputs = useCallback(async () => {
    if (!selectedStrategyId) return;

    setError(undefined);
    setBusy(true);

    try {
      await loadInputs(selectedStrategyId);
      await refreshStrategyPresets(selectedStrategyId);
      setDiagnostics(
        await adapter.diagnostics(selectedStrategyId),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    loadInputs,
    refreshStrategyPresets,
    selectedStrategyId,
    setError,
  ]);

  const runDiagnostics = useCallback(async () => {
    setError(undefined);

    try {
      await adapter.ensureStrategyTester();
      setDiagnostics(
        await adapter.diagnostics(
          selectedStrategyId || undefined,
        ),
      );
      setDiagnosticsOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }, [adapter, selectedStrategyId, setError]);

  const saveCurrentPreset = useCallback(async () => {
    if (!selectedStrategyId || inputs.length === 0) return;

    setBusy(true);
    setError(undefined);

    try {
      const name = presetName.trim();
      if (!name) {
        throw new Error('Enter a name for the configuration');
      }

      const strategy = strategies.find(
        (item) => item.id === selectedStrategyId,
      );
      if (!strategy) {
        throw new Error(
          'Selected strategy is no longer available',
        );
      }

      const signature =
        await adapter.getStrategySignature(selectedStrategyId);

      if (
        currentStrategySignature &&
        signature !== currentStrategySignature
      ) {
        throw new Error(
          'The strategy changed since its inputs were read. Reload the inputs before saving this configuration.',
        );
      }

      const saved = await saveStrategyPreset({
        name,
        strategyName: strategy.name,
        strategySignature: signature,
        parameterConfigs,
        draft: form,
      });

      setCurrentStrategySignature(signature);
      setSavedPresets(
        await loadStrategyPresets(signature),
      );
      setSelectedPresetId(saved.id);
      setPresetName(saved.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    form,
    inputs.length,
    parameterConfigs,
    presetName,
    selectedStrategyId,
    setError,
    strategies,
  ]);

  const loadSelectedPreset = useCallback(async () => {
    if (!selectedStrategyId || !selectedPresetId) return;

    setBusy(true);
    setError(undefined);

    try {
      const preset = savedPresets.find(
        (item) => item.id === selectedPresetId,
      );
      if (!preset) {
        throw new Error('Saved configuration was not found');
      }

      const signature =
        await adapter.getStrategySignature(selectedStrategyId);
      if (signature !== preset.strategySignature) {
        throw new Error(
          'This saved configuration belongs to a different version of the strategy. Reload the strategy inputs first.',
        );
      }

      setParameterConfigs(
        reconcileParameterConfigs(
          inputs,
          preset.parameterConfigs,
        ),
      );
      setForm(
        cloneOptimisationDraft(
          preset.draft,
        ),
      );
      setPresetName(preset.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    inputs,
    savedPresets,
    selectedPresetId,
    selectedStrategyId,
    setError,
  ]);

  const deleteSelectedPreset = useCallback(async () => {
    if (!selectedPresetId) return;

    setBusy(true);
    setError(undefined);

    try {
      await deleteStrategyPreset(selectedPresetId);

      if (currentStrategySignature) {
        setSavedPresets(
          await loadStrategyPresets(
                  ),
        );
      }

      setSelectedPresetId('');
      setPresetName('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }, [
    currentStrategySignature,
    selectedPresetId,
    setError,
  ]);

  const choosePreset = useCallback(
    (presetId: string) => {
      setSelectedPresetId(presetId);
      const preset = savedPresets.find(
        (item) => item.id === presetId,
      );
      if (preset) setPresetName(preset.name);
    },
    [savedPresets],
  );

  const editParameterConfig = useCallback(
    (edit: ParameterConfigEdit) => {
      setParameterConfigs((current) =>
        applyParameterConfigEdit(
          current,
          inputs,
          edit,
        ),
      );
    },
    [inputs],
  );

  const updateForm = useCallback(
    (patch: Partial<OptimisationForm>) => {
      setForm((current) => ({
        ...current,
        ...patch,
      }));
    },
    [],
  );

  const updateFilter = useCallback(
    (
      key:
        | 'maxDrawdownFilter'
        | 'minProfitFactorFilter'
        | 'minTradesFilter',
      patch: Partial<FilterConfig>,
    ) => {
      setForm((current) => ({
        ...current,
        [key]: {
          ...current[key],
          ...patch,
        },
      }));
    },
    [],
  );

  const prepareRun = useCallback(
    async (): Promise<PreparedOptimisationRun> => {
      if (!selectedStrategyId) {
        throw new Error('No TradingView strategy is selected');
      }

      const strategy = strategies.find(
        (item) => item.id === selectedStrategyId,
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
      const filters = buildMetricFilters(form);
      const trials = parseTargetTrials(form.targetTrials);
      const researchPlan = buildResearchPlan(
        form,
        trials,
      );
      const backtestRange =
        researchPlan.backtestRange;
      const metric = metricDefinition(form.objectiveMetric);

      const chart = await adapter.getChartContext();
      const strategySignature =
        await adapter.getStrategySignature(
          selectedStrategyId,
        );

      const config: CreateRun = {
        run_id: crypto.randomUUID(),
        objective_metric: form.objectiveMetric,
        direction: metric.direction,
        target_trials: trials,
        parameters,
        filters,
        chart: {
          symbol: chart.symbol,
          timeframe: chart.timeframe,
          strategy_name: strategy.name,
          strategy_signature: strategySignature,
          strategy_settings_signature: null,
        },
        backtest_range: backtestRange,
        baseline_parameters: baselineParameters,
        research: researchPlan.research,
      };

      return prepareTradingViewRun(
        adapter,
        selectedStrategyId,
        config,
        inputs,
      );
    },
    [
      adapter,
      form,
      inputs,
      parameterConfigs,
      selectedStrategyId,
      strategies,
    ],
  );

  const resolveStrategyForConfig = useCallback(
    async (
      config: CreateRun,
    ): Promise<{
      detected: DetectedStrategy[];
      strategy: DetectedStrategy;
    }> => {
      const chart =
        await adapter.getChartContext();

      if (!sameChart(config.chart, chart)) {
        throw new Error(
          'The current TradingView symbol/timeframe does not match this experiment.',
        );
      }

      const detected =
        await adapter.detectStrategies();

      for (const strategy of detected) {
        if (
          strategy.name !==
          config.chart.strategy_name
        ) {
          continue;
        }

        const signature =
          await adapter.getStrategySignature(
            strategy.id,
          );

        if (
          signature ===
          config.chart.strategy_signature
        ) {
          return {
            detected,
            strategy,
          };
        }
      }

      throw new Error(
        'The experiment strategy version/input structure is not present on the current chart.',
      );
    },
    [adapter],
  );

  const loadExperimentConfiguration =
    useCallback(
      async (
        config: CreateRun,
      ): Promise<string> => {
        const resolved =
          await resolveStrategyForConfig(
            config,
          );

        setStrategies(resolved.detected);
        selectedStrategyIdRef.current =
          resolved.strategy.id;
        setSelectedStrategyId(
          resolved.strategy.id,
        );

        await loadInputs(
          resolved.strategy.id,
          config,
        );
        await refreshStrategyPresets(
          resolved.strategy.id,
        );

        return resolved.strategy.id;
      },
      [
        loadInputs,
        refreshStrategyPresets,
        resolveStrategyForConfig,
      ],
    );

  const prepareExperimentRerun =
    useCallback(
      async (
        source: CreateRun,
      ): Promise<PreparedOptimisationRun> => {
        const resolved =
          await resolveStrategyForConfig(
            source,
          );
        const strategyId =
          resolved.strategy.id;
        const detectedInputs =
          await adapter.readStrategyInputs(
            strategyId,
          );

        setStrategies(resolved.detected);
        selectedStrategyIdRef.current =
          strategyId;
        setSelectedStrategyId(
          strategyId,
        );
        setInputs(detectedInputs);
        setParameterConfigs(
          parameterConfigsFromRun(
            detectedInputs,
            source,
          ),
        );
        setForm(
          formFromRun(source),
        );
        await refreshStrategyPresets(
          strategyId,
        );

        const chart =
          await adapter.getChartContext();
        const strategySignature =
          await adapter.getStrategySignature(
            strategyId,
          );
        const baselineParameters =
          buildBaselineParameters(
            detectedInputs,
            source.parameters,
          );

        const config: CreateRun = {
          ...source,
          run_id:
            crypto.randomUUID(),
          baseline_parameters:
            baselineParameters,
          chart: {
            symbol: chart.symbol,
            timeframe: chart.timeframe,
            strategy_name:
              resolved.strategy.name,
            strategy_signature:
              strategySignature,
            strategy_settings_signature:
              null,
          },
        };

        return prepareTradingViewRun(
          adapter,
          strategyId,
          config,
          detectedInputs,
        );
      },
      [
        adapter,
        refreshStrategyPresets,
        resolveStrategyForConfig,
      ],
    );

  const restorePersistedRun = useCallback(
    async (
      candidate: PersistedOptimisationRun,
    ): Promise<string> => {
      const strategyId =
        await loadExperimentConfiguration(
          candidate.config,
        );

      await adapter.prepareBacktest(
        strategyId,
        candidate.config.backtest_range
          ? {
              startDate:
                candidate.config
                  .backtest_range
                  .start_date,
              endDate:
                candidate.config
                  .backtest_range
                  .end_date,
            }
          : null,
      );

      return strategyId;
    },
    [
      adapter,
      loadExperimentConfiguration,
    ],
  );

  useEffect(() => {
    void probe();
  }, [probe]);

  const optimisableInputs = useMemo(
    () => inputs.filter(isOptimisableInput),
    [inputs],
  );

  const selectedInputCount = useMemo(
    () =>
      optimisableInputs.filter(
        (input) =>
          parameterConfigs[input.id]?.enabled,
      ).length,
    [optimisableInputs, parameterConfigs],
  );

  const inputLabel = useCallback(
    (id: string): string =>
      inputs.find((input) => input.id === id)?.label ??
      id,
    [inputs],
  );

  const conditionCandidates = useCallback(
    (inputId: string) =>
      conditionCandidatesFor(
        inputId,
        inputs,
        parameterConfigs,
      ),
    [inputs, parameterConfigs],
  );

  return {
    strategies,
    selectedStrategyId,
    inputs,
    parameterConfigs,
    form,
    currentStrategySignature,
    savedPresets,
    selectedPresetId,
    presetName,
    diagnostics,
    diagnosticsOpen,
    busy,
    optimisableInputs,
    selectedInputCount,
    probe,
    selectStrategy,
    readInputs,
    runDiagnostics,
    hideDiagnostics: () => setDiagnosticsOpen(false),
    setPresetName,
    choosePreset,
    saveCurrentPreset,
    loadSelectedPreset,
    deleteSelectedPreset,
    editParameterConfig,
    updateForm,
    updateFilter,
    conditionCandidates,
    prepareRun,
    prepareExperimentRerun,
    loadExperimentConfiguration,
    restorePersistedRun,
    inputLabel,
  };
}

export type StrategyConfigurationModel = ReturnType<
  typeof useStrategyConfiguration
>;
