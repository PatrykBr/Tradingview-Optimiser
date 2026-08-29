import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  deleteExperiment,
  loadExperimentHistory,
  updateExperimentAnalysis,
  updateExperimentResearch,
  type ExperimentRecord,
} from '../../lib/optimisation/storage';
import {
  buildStabilityVariants,
  degradationPercent,
  median,
  passesMetricFilters,
  rankRobustnessCandidates,
  splitResearchRange,
  stabilityRating,
  topFeasibleCandidates,
  type ResearchEvaluation,
  type RobustnessCandidateResult,
  type RobustnessFoldResult,
  type StabilityNeighbourResult,
  type StabilityParameterResult,
} from '../../lib/optimisation/research';
import type {
  BacktestRange,
  CreateRun,
  RunAnalysis,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import type { OptimisationRunModel } from './useOptimisationRun';

type ErrorSetter = Dispatch<
  SetStateAction<string | undefined>
>;

interface UseResearchValidationOptions {
  adapter: TradingViewAdapter;
  run: OptimisationRunModel;
  strategyId: string;
  setError: ErrorSetter;
}

const terminalStatus = (
  status: string | undefined,
): boolean =>
  status === 'completed' ||
  status === 'stopped' ||
  status === 'failed';

const deepRange = (
  startDate: string,
  endDate: string,
): BacktestRange => ({
  mode: 'deep',
  start_date: startDate,
  end_date: endDate,
});

const objectiveValue = (
  metrics: Record<string, number>,
  metric: string,
): number | null => {
  const value = metrics[metric];
  return Number.isFinite(value) ? value! : null;
};

export function useResearchValidation({
  adapter,
  run,
  strategyId,
  setError,
}: UseResearchValidationOptions) {
  const [analysis, setAnalysis] =
    useState<RunAnalysis | null>(null);
  const [research, setResearch] =
    useState<ResearchEvaluation | null>(null);
  const [experiments, setExperiments] = useState<
    ExperimentRecord[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>();
  const validationAbortRef =
    useRef<AbortController | null>(null);

  const refreshHistory = useCallback(async () => {
    const history = await loadExperimentHistory();
    setExperiments(history);

    const runId = run.runConfig?.run_id;
    if (!runId) return;

    const current = history.find(
      (experiment) =>
        experiment.runId === runId,
    );
    if (current?.analysis) {
      setAnalysis(current.analysis);
    }
    if (current?.research) {
      setResearch(current.research);
    }
  }, [run.runConfig?.run_id]);

  useEffect(() => {
    setAnalysis(null);
    setResearch(null);
    void refreshHistory();
  }, [
    refreshHistory,
    run.runConfig?.run_id,
  ]);

  useEffect(() => {
    if (!terminalStatus(run.progress?.status)) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshHistory();
    }, 150);

    return () => clearTimeout(timer);
  }, [
    refreshHistory,
    run.progress?.status,
  ]);

  useEffect(() => {
    const status = run.progress?.status;
    const runId = run.runConfig?.run_id;

    if (
      !runId ||
      !terminalStatus(status) ||
      !run.connected
    ) {
      return;
    }

    let cancelled = false;

    const loadAnalysis = async () => {
      try {
        const history =
          await loadExperimentHistory();
        const stored = history.find(
          (experiment) =>
            experiment.runId === runId,
        );

        if (stored?.analysis) {
          if (!cancelled) {
            setAnalysis(stored.analysis);
            setExperiments(history);
          }
          return;
        }

        const result =
          await run.getRunAnalysis();
        if (!result || cancelled) return;

        setAnalysis(result);
        await updateExperimentAnalysis(
          runId,
          result,
        );
        await refreshHistory();
      } catch {
        // Analysis is supplemental. A finished optimisation remains valid
        // even if the local backend was restarted before importance was read.
      }
    };

    const timer = setTimeout(() => {
      void loadAnalysis();
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    refreshHistory,
    run.connected,
    run.progress?.status,
    run.runConfig?.run_id,
  ]);

  const validateContext = useCallback(
    async (
      config: CreateRun,
      range: BacktestRange | null,
    ) => {
      if (!strategyId) {
        throw new Error(
          'Select the strategy used by this experiment before running validation',
        );
      }

      await adapter.assertRunContext(
        strategyId,
        {
          ...config,
          backtest_range: range,
        },
        run.getOriginalParameters(),
      );
    },
    [adapter, run, strategyId],
  );

  const runValidation = useCallback(async () => {
    const config = run.runConfig;
    const progress = run.progress;
    const settings = config?.research;

    if (
      !config ||
      !progress ||
      !progress.best ||
      !terminalStatus(progress.status)
    ) {
      return;
    }

    if (
      !settings?.robustness.enabled &&
      !settings?.stability.enabled
    ) {
      return;
    }

    if (!strategyId) {
      throw new Error(
        'The experiment strategy is not selected on the current chart',
      );
    }

    setBusy(true);
    setError(undefined);
    setPhase('Preparing validation');

    const controller = new AbortController();
    validationAbortRef.current = controller;
    const evaluation: ResearchEvaluation = {};
    let winnerParameters =
      progress.best.parameters;

    try {
      if (settings.robustness.enabled) {
        const fullRange =
          settings.robustness.full_range;
        if (!fullRange) {
          throw new Error(
            'This experiment has no full range for robustness validation',
          );
        }

        const plan = splitResearchRange(
          fullRange,
          settings.robustness
            .validation_fraction,
          settings.robustness.folds,
        );
        const candidates = topFeasibleCandidates(
          progress.trials,
          config.direction,
          settings.robustness
            .top_candidates,
        );

        if (candidates.length === 0) {
          throw new Error(
            'No feasible completed trials are available for robustness validation',
          );
        }

        const candidateResults: RobustnessCandidateResult[] =
          [];

        for (
          let candidateIndex = 0;
          candidateIndex < candidates.length;
          candidateIndex += 1
        ) {
          const candidate =
            candidates[candidateIndex]!;
          const folds: RobustnessFoldResult[] =
            [];

          for (
            let foldIndex = 0;
            foldIndex <
            plan.validationWindows.length;
            foldIndex += 1
          ) {
            const window =
              plan.validationWindows[foldIndex]!;
            setPhase(
              'OOS candidate ' +
                (candidateIndex + 1) +
                '/' +
                candidates.length +
                ' · fold ' +
                (foldIndex + 1) +
                '/' +
                plan.validationWindows.length,
            );

            const range = deepRange(
              window.startDate,
              window.endDate,
            );
            const metrics =
              await adapter.evaluateParameters(
                strategyId,
                candidate.parameters,
                {
                  startDate:
                    window.startDate,
                  endDate: window.endDate,
                },
                controller.signal,
              );

            await validateContext(
              config,
              range,
            );

            const objective = objectiveValue(
              metrics,
              config.objective_metric,
            );
            folds.push({
              window,
              metrics,
              objectiveValue: objective,
              passedFilters:
                objective !== null &&
                passesMetricFilters(
                  metrics,
                  config.filters,
                ),
            });
          }

          const values = folds
            .map((fold) => fold.objectiveValue)
            .filter(
              (value): value is number =>
                value !== null,
            );
          const validationObjective =
            median(values);
          const optimisationObjective =
            candidate.objective_value!;

          candidateResults.push({
            trialNumber:
              candidate.trial_number,
            parameters:
              candidate.parameters,
            optimisationObjective,
            validationObjective,
            passedWindows: folds.filter(
              (fold) =>
                fold.passedFilters,
            ).length,
            totalWindows: folds.length,
            degradationPercent:
              validationObjective === null
                ? null
                : degradationPercent(
                    optimisationObjective,
                    validationObjective,
                    config.direction,
                  ),
            folds,
          });
        }

        const ranked =
          rankRobustnessCandidates(
            candidateResults,
            config.direction,
          );
        const winner = ranked[0] ?? null;

        evaluation.robustness = {
          trainingRange:
            plan.trainingRange,
          validationWindows:
            plan.validationWindows,
          candidates: ranked,
          winnerTrialNumber:
            winner?.trialNumber ?? null,
          winnerParameters:
            winner?.parameters ?? null,
        };

        if (winner) {
          winnerParameters =
            winner.parameters;
        }
      }

      if (settings.stability.enabled) {
        const validationWindows =
          evaluation.robustness
            ?.validationWindows;
        const range =
          validationWindows &&
          validationWindows.length > 0
            ? deepRange(
                validationWindows[0]!
                  .startDate,
                validationWindows.at(-1)!
                  .endDate,
              )
            : config.backtest_range ??
              null;

        setPhase(
          'Testing winner stability',
        );

        const baselineMetrics =
          await adapter.evaluateParameters(
            strategyId,
            winnerParameters,
            range
              ? {
                  startDate:
                    range.start_date,
                  endDate:
                    range.end_date,
                }
              : null,
            controller.signal,
          );
        await validateContext(
          config,
          range,
        );

        const baselineObjective =
          objectiveValue(
            baselineMetrics,
            config.objective_metric,
          );
        if (baselineObjective === null) {
          throw new Error(
            'TradingView did not expose the objective metric for the stability baseline',
          );
        }

        const variants =
          buildStabilityVariants(
            config.parameters,
            winnerParameters,
            settings.stability
              .perturbation_percent,
          );

        const grouped = new Map<
          string,
          {
            baselineValue: number;
            neighbours: StabilityNeighbourResult[];
          }
        >();

        for (
          let index = 0;
          index < variants.length;
          index += 1
        ) {
          const variant = variants[index]!;
          setPhase(
            'Stability test ' +
              (index + 1) +
              '/' +
              variants.length,
          );

          const metrics =
            await adapter.evaluateParameters(
              strategyId,
              variant.parameters,
              range
                ? {
                    startDate:
                      range.start_date,
                    endDate:
                      range.end_date,
                  }
                : null,
              controller.signal,
            );
          await validateContext(
            config,
            range,
          );

          const objective =
            objectiveValue(
              metrics,
              config.objective_metric,
            );
          const passed =
            objective !== null &&
            passesMetricFilters(
              metrics,
              config.filters,
            );
          const degradation =
            objective === null
              ? null
              : degradationPercent(
                  baselineObjective,
                  objective,
                  config.direction,
                );

          const current =
            grouped.get(
              variant.parameter,
            ) ?? {
              baselineValue:
                variant.baselineValue,
              neighbours: [],
            };

          current.neighbours.push({
            value: variant.value,
            objectiveValue: objective,
            degradationPercent:
              degradation,
            passedFilters: passed,
          });
          grouped.set(
            variant.parameter,
            current,
          );
        }

        const parameters: StabilityParameterResult[] =
          [...grouped.entries()].map(
            ([parameter, result]) => {
              const degradations =
                result.neighbours.map(
                  (neighbour) =>
                    neighbour.passedFilters &&
                    neighbour
                      .degradationPercent !==
                      null
                      ? Math.max(
                          0,
                          neighbour
                            .degradationPercent,
                        )
                      : 100,
                );
              const average =
                degradations.length > 0
                  ? degradations.reduce(
                      (sum, value) =>
                        sum + value,
                      0,
                    ) /
                    degradations.length
                  : 0;

              return {
                parameter,
                baselineValue:
                  result.baselineValue,
                rating:
                  stabilityRating(average),
                averageDegradationPercent:
                  average,
                neighbours:
                  result.neighbours,
              };
            },
          );

        const worst =
          parameters.length > 0
            ? Math.max(
                ...parameters.map(
                  (parameter) =>
                    parameter
                      .averageDegradationPercent,
                ),
              )
            : 0;

        evaluation.stability = {
          baselineObjective,
          range,
          overallRating:
            stabilityRating(worst),
          parameters,
        };
      }

      setResearch(evaluation);
      await updateExperimentResearch(
        config.run_id,
        evaluation,
      );
      await refreshHistory();
    } catch (cause) {
      const cancelled =
        cause instanceof DOMException &&
        cause.name === 'AbortError';

      if (!cancelled) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      }
    } finally {
      setPhase(undefined);

      try {
        await adapter.prepareBacktest(
          strategyId,
          config.backtest_range
            ? {
                startDate:
                  config.backtest_range
                    .start_date,
                endDate:
                  config.backtest_range
                    .end_date,
              }
            : null,
        );
        await adapter.applyParameters(
          strategyId,
          winnerParameters,
        );
      } catch {
        // Preserve the original validation error if restoration also fails.
      }

      if (
        validationAbortRef.current === controller
      ) {
        validationAbortRef.current = null;
      }
      setBusy(false);
    }
  }, [
    adapter,
    refreshHistory,
    run,
    setError,
    strategyId,
    validateContext,
  ]);

  const cancelValidation = useCallback(() => {
    validationAbortRef.current?.abort();
  }, []);

  const applyRobustWinner =
    useCallback(async () => {
      const parameters =
        research?.robustness
          ?.winnerParameters;
      if (!parameters || !strategyId) {
        return;
      }

      await adapter.applyParameters(
        strategyId,
        parameters,
      );
    }, [
      adapter,
      research?.robustness
        ?.winnerParameters,
      strategyId,
    ]);

  const removeExperiment =
    useCallback(
      async (runId: string) => {
        await deleteExperiment(runId);
        await refreshHistory();
      },
      [refreshHistory],
    );

  return {
    analysis,
    research,
    experiments,
    busy,
    phase,
    runValidation,
    cancelValidation,
    applyRobustWinner,
    refreshHistory,
    removeExperiment,
  };
}

export type ResearchValidationModel =
  ReturnType<typeof useResearchValidation>;
