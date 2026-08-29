import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  runMonteCarloValidation,
} from '../../lib/optimisation/monte-carlo-runner';
import {
  runResearchValidation,
} from '../../lib/optimisation/research-runner';
import {
  runWalkForwardValidation,
} from '../../lib/optimisation/walk-forward-runner';
import type {
  ResearchEvaluation,
} from '../../lib/optimisation/research';
import {
  deleteExperiment,
  loadExperimentHistory,
  updateExperimentAnalysis,
  updateExperimentResearch,
  type ExperimentRecord,
} from '../../lib/optimisation/storage';
import type {
  RunAnalysis,
} from '../../lib/protocol/types';
import type {
  TradingViewAdapter,
} from '../../lib/tradingview/adapter';
import type {
  OptimisationRunModel,
} from './useOptimisationRun';

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

const isAbortError = (
  cause: unknown,
): boolean =>
  cause instanceof DOMException &&
  cause.name === 'AbortError';

export function useResearchValidation({
  adapter,
  run,
  strategyId,
  setError,
}: UseResearchValidationOptions) {
  const [analysis, setAnalysis] =
    useState<RunAnalysis | null>(null);
  const [research, setResearch] =
    useState<ResearchEvaluation | null>(
      null,
    );
  const [experiments, setExperiments] =
    useState<ExperimentRecord[]>([]);
  const [busy, setBusy] =
    useState(false);
  const [phase, setPhase] =
    useState<string>();
  const validationAbortRef =
    useRef<AbortController | null>(
      null,
    );

  const refreshHistory =
    useCallback(async () => {
      const history =
        await loadExperimentHistory();
      setExperiments(history);

      const runId =
        run.runConfig?.run_id;
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

  useEffect(
    () => () => {
      validationAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    setAnalysis(null);
    setResearch(null);
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (
      !terminalStatus(
        run.progress?.status,
      )
    ) {
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
    const status =
      run.progress?.status;
    const runId =
      run.runConfig?.run_id;

    if (
      !runId ||
      !terminalStatus(status) ||
      !run.connected
    ) {
      return;
    }

    let cancelled = false;

    const loadAnalysis =
      async () => {
        try {
          const history =
            await loadExperimentHistory();
          const stored = history.find(
            (experiment) =>
              experiment.runId === runId,
          );

          if (stored?.analysis) {
            if (!cancelled) {
              setAnalysis(
                stored.analysis,
              );
              setExperiments(history);
            }
            return;
          }

          const result =
            await run.getRunAnalysis();

          if (!result || cancelled) {
            return;
          }

          setAnalysis(result);
          await updateExperimentAnalysis(
            runId,
            result,
          );
          await refreshHistory();
        } catch {
          // Importance is supplemental; the completed optimisation stays valid.
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
    run.getRunAnalysis,
    run.progress?.status,
    run.runConfig?.run_id,
  ]);

  const runValidation =
    useCallback(async () => {
      const config = run.runConfig;
      const progress = run.progress;
      const settings =
        config?.research;

      if (
        !config ||
        !progress ||
        !progress.best ||
        !terminalStatus(
          progress.status,
        ) ||
        !settings ||
        (!settings.robustness.enabled &&
          !settings.stability.enabled &&
          !settings.walk_forward.enabled &&
          !settings.monte_carlo.enabled)
      ) {
        return;
      }

      if (!strategyId) {
        setError(
          'The experiment strategy is not selected on the current chart',
        );
        return;
      }

      setBusy(true);
      setError(undefined);

      const controller =
        new AbortController();
      validationAbortRef.current =
        controller;

      try {
        const originalParameters =
          run.getOriginalParameters();
        const evaluation =
          await runResearchValidation({
            adapter,
            strategyId,
            config,
            progress,
            originalParameters,
            signal: controller.signal,
            onPhase: setPhase,
          });

        if (
          settings.walk_forward.enabled
        ) {
          evaluation.walkForward =
            await runWalkForwardValidation({
              adapter,
              runStudy:
                run.runAuxiliaryOptimisation,
              strategyId,
              config,
              parentProgress: progress,
              originalParameters,
              signal: controller.signal,
              onPhase: setPhase,
            });
        }

        if (
          settings.monte_carlo.enabled
        ) {
          evaluation.monteCarlo =
            await runMonteCarloValidation({
              adapter,
              strategyId,
              config,
              progress,
              existingResearch:
                evaluation,
              originalParameters,
              signal: controller.signal,
              onPhase: setPhase,
            });
        }

        setResearch(evaluation);
        await updateExperimentResearch(
          config.run_id,
          evaluation,
        );
        await refreshHistory();
      } catch (cause) {
        if (!isAbortError(cause)) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        }
      } finally {
        setPhase(undefined);

        if (
          validationAbortRef.current ===
          controller
        ) {
          validationAbortRef.current =
            null;
        }

        setBusy(false);
      }
    }, [
      adapter,
      refreshHistory,
      run.getOriginalParameters,
      run.runAuxiliaryOptimisation,
      run.progress,
      run.runConfig,
      setError,
      strategyId,
    ]);

  const cancelValidation =
    useCallback(() => {
      validationAbortRef.current?.abort();
    }, []);

  const applyRobustWinner =
    useCallback(async () => {
      const parameters =
        research?.robustness
          ?.winnerParameters;

      if (
        !parameters ||
        !strategyId
      ) {
        return;
      }

      try {
        await adapter.applyParameters(
          strategyId,
          parameters,
        );
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      }
    }, [
      adapter,
      research?.robustness
        ?.winnerParameters,
      setError,
      strategyId,
    ]);

  const removeExperiment =
    useCallback(
      async (runId: string) => {
        try {
          await deleteExperiment(
            runId,
          );
          await refreshHistory();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        }
      },
      [
        refreshHistory,
        setError,
      ],
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
    removeExperiment,
  };
}

export type ResearchValidationModel =
  ReturnType<
    typeof useResearchValidation
  >;
