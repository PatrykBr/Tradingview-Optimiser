import { isTerminalStatus } from '../../lib/optimisation/run-progress';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { toOptimiserError } from '../../lib/errors';
import { runResearchValidation } from '../../lib/optimisation/research-runner';
import {
  deleteExperiment,
  loadExperimentHistory,
  updateExperimentAnalysis,
  updateExperimentResearch,
  type ExperimentRecord,
} from '../../lib/optimisation/storage';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import type { OptimisationRunModel } from './useOptimisationRun';

type ErrorSetter = Dispatch<SetStateAction<string | undefined>>;

interface UseResearchValidationOptions {
  adapter: TradingViewAdapter;
  run: OptimisationRunModel;
  strategyId: string;
  setError: ErrorSetter;
}

const isAbortError = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === 'AbortError';

export function useResearchValidation({
  adapter,
  run,
  strategyId,
  setError,
}: UseResearchValidationOptions) {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>();
  const [analysisError, setAnalysisError] = useState<string>();
  const validationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAnalysisError(undefined);
  }, [run.runConfig?.run_id]);

  const refreshHistory = useCallback(async () => {
    setExperiments(await loadExperimentHistory());
  }, []);

  useEffect(
    () => () => {
      validationAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    void refreshHistory().catch((cause) => {
      setError('Could not load experiment history: ' + toOptimiserError(cause).message);
    });
  }, [refreshHistory, setError]);

  useEffect(() => {
    if (!isTerminalStatus(run.progress?.status)) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshHistory().catch((cause) => {
        setError('Could not refresh experiment history: ' + toOptimiserError(cause).message);
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [refreshHistory, run.progress?.status, setError]);

  const currentExperiment = experiments.find(
    (experiment) => experiment.runId === run.runConfig?.run_id,
  );
  const analysis = currentExperiment?.analysis ?? null;
  const research = currentExperiment?.research ?? null;

  useEffect(() => {
    const status = run.progress?.status;
    const runId = run.runConfig?.run_id;

    if (!runId || analysis || !isTerminalStatus(status) || !run.connected) {
      return;
    }

    let cancelled = false;

    const loadAnalysis = async () => {
      setAnalysisError(undefined);

      try {
        const result = await run.getRunAnalysis();

        if (!result || cancelled) {
          return;
        }

        await updateExperimentAnalysis(runId, result);

        if (result.parameter_importance_status === 'failed') {
          setAnalysisError(
            result.parameter_importance_error ?? 'Parameter importance analysis failed',
          );
        }

        if (!cancelled) {
          await refreshHistory();
        }
      } catch (cause) {
        if (!cancelled) {
          setAnalysisError(toOptimiserError(cause).message);
        }
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
    analysis,
    refreshHistory,
    run.connected,
    run.getRunAnalysis,
    run.progress?.status,
    run.runConfig?.run_id,
  ]);

  const runValidation = useCallback(async () => {
    const config = run.runConfig;
    const progress = run.progress;
    const settings = config?.research;

    if (
      !config ||
      !progress ||
      !progress.best ||
      !isTerminalStatus(progress.status) ||
      !settings ||
      (!settings.robustness.enabled &&
        !settings.stability.enabled &&
        !settings.walk_forward?.enabled &&
        !settings.monte_carlo?.enabled)
    ) {
      return;
    }

    if (!strategyId) {
      setError('The experiment strategy is not selected on the current chart');
      return;
    }

    setBusy(true);
    setError(undefined);

    const controller = new AbortController();
    validationAbortRef.current = controller;

    try {
      const originalParameters = run.getOriginalParameters();
      const evaluation = await runResearchValidation({
        adapter,
        strategyId,
        config,
        progress,
        originalParameters,
        signal: controller.signal,
        onPhase: setPhase,
        runStudy: run.runAuxiliaryOptimisation,
      });

      await updateExperimentResearch(config.run_id, evaluation);
      await refreshHistory();
    } catch (cause) {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setPhase(undefined);

      if (validationAbortRef.current === controller) {
        validationAbortRef.current = null;
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

  const cancelValidation = useCallback(() => {
    validationAbortRef.current?.abort();
  }, []);

  const applyRobustWinner = useCallback(async () => {
    const parameters = research?.robustness?.winnerParameters;

    if (!parameters || !strategyId) {
      return;
    }

    try {
      await adapter.applyParameters(strategyId, parameters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [adapter, research?.robustness?.winnerParameters, setError, strategyId]);

  const removeExperiment = useCallback(
    async (runId: string) => {
      try {
        await deleteExperiment(runId);
        await refreshHistory();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshHistory, setError],
  );

  return {
    analysis,
    analysisError,
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

export type ResearchValidationModel = ReturnType<typeof useResearchValidation>;
