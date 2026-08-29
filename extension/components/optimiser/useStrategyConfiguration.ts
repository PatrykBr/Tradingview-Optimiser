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
  reconcilePresetParameterConfigs,
  saveStrategyPreset,
  type SavedOptimisationPreset,
} from '../../lib/optimisation/presets';
import {
  buildBaselineParameters,
  buildSearchSpace,
  conditionCandidatesFor,
  defaultParameterConfig,
  isOptimisableInput,
  type ParameterConfig,
} from '../../lib/optimisation/search-space';
import { metricDefinition } from '../../lib/optimisation/metrics';
import type {
  CreateRun,
  Primitive,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import type {
  DetectedStrategy,
  StrategyInput,
  TradingViewDiagnostics,
} from '../../lib/tradingview/types';
import type { PersistedOptimisationRun } from '../../lib/optimisation/storage';
import {
  buildMetricFilters,
  buildResearchPlan,
  DEFAULT_OPTIMISATION_FORM,
  formFromPreset,
  formFromRun,
  parameterConfigsFromRun,
  parseTargetTrials,
  sameChart,
  type FilterConfig,
  type OptimisationForm,
} from './configuration';

export interface PreparedOptimisationRun {
  config: CreateRun;
  strategyId: string;
  originalParameters: Record<string, unknown>;
}

type ErrorSetter = Dispatch<SetStateAction<string | undefined>>;

const freshParameterConfigs = (
  inputs: StrategyInput[],
): Record<string, ParameterConfig> =>
  Object.fromEntries(
    inputs.map((input) => [
      input.id,
      defaultParameterConfig(input),
    ]),
  );

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
      const nextSelected =
        detected.length === 1
          ? detected[0]!.id
          : detected.some(
                (strategy) =>
                  strategy.id ===
                  currentSelection,
              )
            ? currentSelection
            : '';

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
          : freshParameterConfigs(detectedInputs),
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
        objectiveMetric: form.objectiveMetric,
        targetTrials: form.targetTrials,
        maxDrawdownFilter: form.maxDrawdownFilter,
        minProfitFactorFilter: form.minProfitFactorFilter,
        minTradesFilter: form.minTradesFilter,
        dateRangeEnabled: form.dateRangeEnabled,
        startDate: form.startDate,
        endDate: form.endDate,
        convergenceEnabled: form.convergenceEnabled,
        convergenceMinTrials: form.convergenceMinTrials,
        convergencePatience: form.convergencePatience,
        convergenceMinImprovementPercent:
          form.convergenceMinImprovementPercent,
        robustnessEnabled: form.robustnessEnabled,
        robustnessValidationPercent:
          form.robustnessValidationPercent,
        robustnessFolds: form.robustnessFolds,
        robustnessTopCandidates:
          form.robustnessTopCandidates,
        stabilityEnabled: form.stabilityEnabled,
        stabilityPerturbationPercent:
          form.stabilityPerturbationPercent,
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
        reconcilePresetParameterConfigs(
          inputs,
          preset.parameterConfigs,
        ),
      );
      setForm(formFromPreset(preset));
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
            currentStrategySignature,
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

  const updateParameterConfig = useCallback(
    (
      id: string,
      update: (
        config: ParameterConfig,
      ) => ParameterConfig,
    ) => {
      setParameterConfigs((current) => {
        const config = current[id];
        if (!config) return current;

        return {
          ...current,
          [id]: update(config),
        };
      });
    },
    [],
  );

  const setParameterEnabled = useCallback(
    (id: string, enabled: boolean) => {
      updateParameterConfig(
        id,
        (config) => ({
          ...config,
          enabled,
        }),
      );
    },
    [updateParameterConfig],
  );

  const setParameterField = useCallback(
    (
      id: string,
      field: 'low' | 'high' | 'step',
      value: string,
    ) => {
      updateParameterConfig(
        id,
        (config) => ({
          ...config,
          [field]: value,
        }),
      );
    },
    [updateParameterConfig],
  );

  const setParameterLog = useCallback(
    (id: string, log: boolean) => {
      updateParameterConfig(
        id,
        (config) => ({
          ...config,
          log,
          step: log ? '' : config.step,
        }),
      );
    },
    [updateParameterConfig],
  );

  const toggleChoice = useCallback(
    (id: string, choice: Primitive) => {
      updateParameterConfig(
        id,
        (config) => {
          const exists = config.choices.some(
            (value) => value === choice,
          );

          return {
            ...config,
            choices: exists
              ? config.choices.filter(
                  (value) => value !== choice,
                )
              : [...config.choices, choice],
          };
        },
      );
    },
    [updateParameterConfig],
  );

  const setConditionParameter = useCallback(
    (id: string, parameterId: string) => {
      setParameterConfigs((current) => {
        const config = current[id];
        if (!config) return current;

        const parent = current[parameterId];
        const firstChoice =
          parent?.choices[0];

        return {
          ...current,
          [id]: {
            ...config,
            conditionParameter: parameterId,
            conditionValues:
              parameterId &&
              firstChoice !== undefined
                ? [firstChoice]
                : [],
          },
        };
      });
    },
    [],
  );

  const toggleConditionValue = useCallback(
    (id: string, value: Primitive) => {
      updateParameterConfig(
        id,
        (config) => {
          const exists =
            config.conditionValues.some(
              (item) => item === value,
            );

          return {
            ...config,
            conditionValues: exists
              ? config.conditionValues.filter(
                  (item) => item !== value,
                )
              : [
                  ...config.conditionValues,
                  value,
                ],
          };
        },
      );
    },
    [updateParameterConfig],
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

      await adapter.prepareBacktest(
        selectedStrategyId,
        backtestRange
          ? {
              startDate: backtestRange.start_date,
              endDate: backtestRange.end_date,
            }
          : null,
      );

      const initialMetrics =
        await adapter.waitForMetricsAfterChange(
          selectedStrategyId,
          null,
          undefined,
          12_000,
        );

      const requiredMetrics = [
        form.objectiveMetric,
        ...filters.map((filter) => filter.metric),
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

      config.chart.strategy_settings_signature =
        await adapter.getStrategySettingsSignature(
          selectedStrategyId,
        );

      return {
        config,
        strategyId: selectedStrategyId,
        originalParameters: Object.fromEntries(
          inputs.map((input) => [
            input.id,
            input.currentValue,
          ]),
        ),
      };
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

  const restorePersistedRun = useCallback(
    async (
      candidate: PersistedOptimisationRun,
    ): Promise<string> => {
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
      selectedStrategyIdRef.current =
        matchingStrategy.id;
      setSelectedStrategyId(matchingStrategy.id);
      await loadInputs(
        matchingStrategy.id,
        candidate.config,
      );
      await refreshStrategyPresets(matchingStrategy.id);

      await adapter.prepareBacktest(
        matchingStrategy.id,
        candidate.config.backtest_range
          ? {
              startDate:
                candidate.config.backtest_range.start_date,
              endDate:
                candidate.config.backtest_range.end_date,
            }
          : null,
      );

      return matchingStrategy.id;
    },
    [adapter, loadInputs, refreshStrategyPresets],
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
    setParameterEnabled,
    setParameterField,
    setParameterLog,
    toggleChoice,
    setConditionParameter,
    toggleConditionValue,
    updateForm,
    updateFilter,
    conditionCandidates,
    prepareRun,
    restorePersistedRun,
    inputLabel,
  };
}

export type StrategyConfigurationModel = ReturnType<
  typeof useStrategyConfiguration
>;
