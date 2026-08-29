import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type { BackgroundMessage } from '../../lib/messages';
import {
  buildRunJson,
  buildTrialsCsv,
} from '../../lib/optimisation/export';
import {
  clearActiveRun,
  finishActiveRun,
  loadActiveRun,
  loadLastRun,
  saveActiveRun,
  updateActiveRunProgress,
  type PersistedOptimisationRun,
} from '../../lib/optimisation/storage';
import type {
  CreateRun,
  NextTrial,
  RunAnalysis,
  RunProgress,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import { useBackendConnection } from './useBackendConnection';
import type { PreparedOptimisationRun } from './useStrategyConfiguration';

interface TrialExecution {
  number: number;
  parameters: Record<string, unknown>;
  phase: 'checking' | 'recalculating' | 'submitting';
}

interface UseOptimisationRunOptions {
  adapter: TradingViewAdapter;
  prepareRun: () => Promise<PreparedOptimisationRun>;
  restorePersistedRun: (
    candidate: PersistedOptimisationRun,
  ) => Promise<string>;
  selectedStrategyId: string;
  setError: Dispatch<SetStateAction<string | undefined>>;
}

const isBackendTransportError = (
  message: string,
): boolean =>
  /backend (is not connected|connection closed|request timed out)|backend client disconnected/i.test(
    message,
  );

const safeFilename = (value: string): string =>
  value
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'optimisation';

export function useOptimisationRun({
  adapter,
  prepareRun,
  restorePersistedRun,
  selectedStrategyId,
  setError,
}: UseOptimisationRunOptions) {
  const backend = useBackendConnection(setError);
  const {
    connected,
    pairingRequired,
    sendRequest,
  } = backend;

  const [progress, setProgress] =
    useState<RunProgress | null>(null);
  const [runConfig, setRunConfig] =
    useState<CreateRun | null>(null);
  const [activeRunId, setActiveRunId] =
    useState<string | null>(null);
  const [currentTrial, setCurrentTrial] =
    useState<TrialExecution | null>(null);
  const [resumeCandidate, setResumeCandidate] =
    useState<PersistedOptimisationRun | null>(null);
  const [stopChoiceVisible, setStopChoiceVisible] =
    useState(false);
  const [busy, setBusy] = useState(false);

  const [startedAt, setStartedAt] =
    useState<number | null>(null);
  const [finishedAt, setFinishedAt] =
    useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());

  const activeRunIdRef = useRef<string | null>(null);
  const activeStrategyIdRef = useRef<string | null>(null);
  const activeConfigRef = useRef<CreateRun | null>(null);
  const originalParametersRef = useRef<
    Record<string, unknown> | null
  >(null);
  const executingTrialRef = useRef<number | null>(null);
  const pendingTrialRef = useRef<NextTrial | null>(null);
  const abortControllerRef =
    useRef<AbortController | null>(null);
  const recoveringBackendRef = useRef(false);
  const consecutiveExecutionFailuresRef = useRef(0);

  const recoverBackendRun =
    useCallback(async () => {
      const config = activeConfigRef.current;
      const runId = activeRunIdRef.current;

      if (
        !config ||
        !runId ||
        recoveringBackendRef.current
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
    }, [sendRequest, setError]);

  const executeTrial = useCallback(
    async (trial: NextTrial) => {
      if (
        trial.run_id !== activeRunIdRef.current
      ) {
        return;
      }

      if (
        executingTrialRef.current ===
          trial.trial_number ||
        pendingTrialRef.current?.trial_number ===
          trial.trial_number
      ) {
        return;
      }

      if (executingTrialRef.current !== null) {
        pendingTrialRef.current = trial;
        return;
      }

      const strategyId =
        activeStrategyIdRef.current;
      const config = activeConfigRef.current;
      if (!strategyId || !config) return;

      executingTrialRef.current =
        trial.trial_number;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const trialStartedAt = Date.now();

      try {
        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'checking',
        });

        await adapter.assertRunContext(
          strategyId,
          config,
          originalParametersRef.current,
        );

        setCurrentTrial({
          number: trial.trial_number,
          parameters: trial.parameters,
          phase: 'recalculating',
        });

        const metrics =
          await adapter.evaluateParameters(
            strategyId,
            trial.parameters,
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
            controller.signal,
          );

        await adapter.assertRunContext(
          strategyId,
          config,
          originalParametersRef.current,
        );

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
            duration_ms:
              Date.now() - trialStartedAt,
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
        } else if (
          /not the outstanding trial|unknown run_id/i.test(
            reason,
          )
        ) {
          // The backend restarted while this browser evaluation
          // was in flight. Recovery will issue the correct trial.
        } else {
          const parameterSpecificRuntimeError =
            /strategy runtime error/i.test(reason);

          if (
            !parameterSpecificRuntimeError &&
            !aborted
          ) {
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
                payload: {
                  runId: trial.run_id,
                },
              });
            }

            await sendRequest({
              type: 'TRIAL_FAILED',
              payload: {
                runId: trial.run_id,
                trialNumber:
                  trial.trial_number,
                reason,
              },
            });
          } catch (failureCause) {
            const failureMessage =
              failureCause instanceof Error
                ? failureCause.message
                : String(failureCause);

            if (
              !/not the outstanding trial/i.test(
                failureMessage,
              )
            ) {
              setError(failureMessage);
            }
          }

          if (!aborted) setError(reason);
        }
      } finally {
        if (
          executingTrialRef.current ===
          trial.trial_number
        ) {
          executingTrialRef.current = null;
        }

        if (
          abortControllerRef.current ===
          controller
        ) {
          abortControllerRef.current = null;
        }

        const pending =
          pendingTrialRef.current;
        if (
          pending &&
          pending.run_id ===
            activeRunIdRef.current &&
          executingTrialRef.current === null
        ) {
          pendingTrialRef.current = null;
          queueMicrotask(() => {
            void executeTrial(pending);
          });
        }
      }
    },
    [
      adapter,
      sendRequest,
      setError,
    ],
  );

  const startOptimisation =
    useCallback(async () => {
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

        const prepared = await prepareRun();
        const now = Date.now();

        const persisted: PersistedOptimisationRun = {
          version: 1,
          config: prepared.config,
          strategyId: prepared.strategyId,
          originalParameters:
            prepared.originalParameters,
          startedAt: now,
        };

        await saveActiveRun(persisted);

        activeRunIdRef.current =
          prepared.config.run_id;
        activeStrategyIdRef.current =
          prepared.strategyId;
        activeConfigRef.current =
          prepared.config;
        originalParametersRef.current =
          prepared.originalParameters;
        pendingTrialRef.current = null;
        consecutiveExecutionFailuresRef.current = 0;

        setRunConfig(prepared.config);
        setStartedAt(now);
        setFinishedAt(null);
        setActiveRunId(
          prepared.config.run_id,
        );
        setProgress(null);
        setCurrentTrial(null);
        setResumeCandidate(null);

        await sendRequest({
          type: 'CREATE_RUN',
          payload: prepared.config,
        });
        await sendRequest({
          type: 'START_RUN',
          payload: {
            runId: prepared.config.run_id,
          },
        });
      } catch (cause) {
        await clearActiveRun();
        activeRunIdRef.current = null;
        activeConfigRef.current = null;
        setActiveRunId(null);
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [
      connected,
      pairingRequired,
      prepareRun,
      sendRequest,
      setError,
    ]);

  const resumeOptimisation =
    useCallback(async () => {
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

        const strategyId =
          await restorePersistedRun(candidate);

        originalParametersRef.current =
          candidate.originalParameters;

        await adapter.assertRunContext(
          strategyId,
          candidate.config,
          originalParametersRef.current,
        );

        activeRunIdRef.current =
          candidate.config.run_id;
        activeStrategyIdRef.current =
          strategyId;
        activeConfigRef.current =
          candidate.config;
        pendingTrialRef.current = null;
        consecutiveExecutionFailuresRef.current = 0;

        setRunConfig(candidate.config);
        setProgress(
          candidate.lastProgress ?? null,
        );
        setStartedAt(candidate.startedAt);
        setFinishedAt(null);
        setActiveRunId(
          candidate.config.run_id,
        );
        setResumeCandidate(null);

        await saveActiveRun({
          ...candidate,
          strategyId,
        });

        await sendRequest({
          type: 'REGISTER_RUN_OWNER',
          payload: {
            runId: candidate.config.run_id,
          },
        });
        await sendRequest({
          type: 'CREATE_RUN',
          payload: candidate.config,
        });
        await sendRequest({
          type: 'START_RUN',
          payload: {
            runId: candidate.config.run_id,
          },
        });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [
      connected,
      pairingRequired,
      restorePersistedRun,
      resumeCandidate,
      sendRequest,
      setError,
    ]);

  const discardResumeCandidate =
    useCallback(async () => {
      await clearActiveRun();
      originalParametersRef.current = null;
      activeStrategyIdRef.current = null;
      activeConfigRef.current = null;
      setResumeCandidate(null);
      setProgress(null);
      setRunConfig(null);
      setStartedAt(null);
      setFinishedAt(null);
    }, []);

  const stopOptimisation =
    useCallback(async () => {
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
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        abortControllerRef.current?.abort();
      }
    }, [sendRequest, setError]);

  const applyParameters = useCallback(
    async (
      parameters: Record<string, unknown>,
    ) => {
      const strategyId =
        activeStrategyIdRef.current ||
        selectedStrategyId;

      if (!strategyId) {
        throw new Error(
          'No TradingView strategy is selected',
        );
      }

      await adapter.applyParameters(
        strategyId,
        parameters,
      );
    },
    [adapter, selectedStrategyId],
  );

  const applyBestParameters =
    useCallback(async () => {
      if (!progress?.best) return;

      setBusy(true);
      setError(undefined);

      try {
        await applyParameters(
          progress.best.parameters,
        );
        setStopChoiceVisible(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [
      applyParameters,
      progress,
      setError,
    ]);

  const restoreOriginalParameters =
    useCallback(async () => {
      if (!originalParametersRef.current) {
        return;
      }

      setBusy(true);
      setError(undefined);

      try {
        await applyParameters(
          originalParametersRef.current,
        );
        setStopChoiceVisible(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [applyParameters, setError]);

  const getRunAnalysis = useCallback(
    async (): Promise<RunAnalysis | null> => {
      const runId =
        runConfig?.run_id ??
        progress?.run_id;
      if (!runId || !connected) return null;

      return sendRequest<RunAnalysis>({
        type: 'GET_RUN_ANALYSIS',
        payload: { runId },
      });
    },
    [
      connected,
      progress?.run_id,
      runConfig?.run_id,
      sendRequest,
    ],
  );

  const getOriginalParameters = useCallback(
    (): Record<string, unknown> | null =>
      originalParametersRef.current
        ? { ...originalParametersRef.current }
        : null,
    [],
  );

  const exportRun = useCallback(
    async (format: 'csv' | 'json') => {
      if (!runConfig || !progress) return;

      const base =
        safeFilename(
          runConfig.chart.strategy_name,
        ) +
        '-' +
        runConfig.run_id.slice(0, 8);
      const isCsv = format === 'csv';

      await sendRequest({
        type: 'EXPORT_RESULTS',
        payload: {
          filename: base + '.' + format,
          mimeType: isCsv
            ? 'text/csv'
            : 'application/json',
          content: isCsv
            ? buildTrialsCsv(
                runConfig,
                progress,
              )
            : buildRunJson(
                runConfig,
                progress,
              ),
        },
      });
    },
    [progress, runConfig, sendRequest],
  );

  const clearDisplayedRun = useCallback(() => {
    if (activeRunIdRef.current) return;

    activeStrategyIdRef.current = null;
    activeConfigRef.current = null;
    originalParametersRef.current = null;
    setProgress(null);
    setRunConfig(null);
    setCurrentTrial(null);
    setStartedAt(null);
    setFinishedAt(null);
    setStopChoiceVisible(false);
  }, []);

  useEffect(() => {
    const initialisePersistedRun = async () => {
      const saved = await loadActiveRun();
      if (saved) {
        setResumeCandidate(saved);
        setProgress(saved.lastProgress ?? null);
        setRunConfig(saved.config);
        setStartedAt(saved.startedAt);
        setFinishedAt(null);
        originalParametersRef.current =
          saved.originalParameters;
        return;
      }

      const last = await loadLastRun();
      if (last?.lastProgress) {
        setProgress(last.lastProgress);
        setRunConfig(last.config);
        setStartedAt(last.startedAt);
        setFinishedAt(
          last.finishedAt ?? null,
        );
        originalParametersRef.current =
          last.originalParameters;
      }
    };

    void initialisePersistedRun().catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    });
  }, [setError]);

  useEffect(() => {
    if (!connected || !activeRunIdRef.current) {
      return;
    }

    queueMicrotask(() => {
      void recoverBackendRun();
    });
  }, [connected, recoverBackendRun]);

  useEffect(() => {
    const listener = (
      message: BackgroundMessage,
    ) => {
      if (message.type === 'RUN_PROGRESS') {
        if (
          message.progress.run_id !==
          activeRunIdRef.current
        ) {
          return;
        }

        setProgress(message.progress);
        void updateActiveRunProgress(
          message.progress,
        );

        if (
          message.progress.status ===
            'completed' ||
          message.progress.status ===
            'stopped' ||
          message.progress.status ===
            'failed'
        ) {
          const finishedRunId =
            message.progress.run_id;

          activeRunIdRef.current = null;
          pendingTrialRef.current = null;
          setFinishedAt(Date.now());
          setActiveRunId(null);
          setCurrentTrial(null);

          if (
            message.progress.status ===
            'stopped'
          ) {
            setStopChoiceVisible(true);
          }

          void finishActiveRun(
            message.progress,
          );
          void sendRequest({
            type: 'CLEAR_RUN_OWNER',
            payload: {
              runId: finishedRunId,
            },
          });
        }
        return;
      }

      if (message.type === 'NEXT_TRIAL') {
        void executeTrial(message.trial);
      }
    };

    browser.runtime.onMessage.addListener(
      listener,
    );
    return () =>
      browser.runtime.onMessage.removeListener(
        listener,
      );
  }, [executeTrial, sendRequest]);

  useEffect(() => {
    if (activeRunId === null) return;

    const timer = setInterval(() => {
      setClock(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [activeRunId]);

  const elapsedMs =
    startedAt === null
      ? null
      : (activeRunId !== null
          ? clock
          : finishedAt ?? clock) -
        startedAt;

  return {
    connected,
    pairingRequired,
    pairingCode: backend.pairingCode,
    optunaVersion: backend.optunaVersion,
    progress,
    runConfig,
    activeRunId,
    currentTrial,
    resumeCandidate,
    stopChoiceVisible,
    busy: busy || backend.busy,
    elapsedMs,
    setPairingCode: backend.setPairingCode,
    pairBackend: backend.pairBackend,
    startOptimisation,
    resumeOptimisation,
    discardResumeCandidate,
    stopOptimisation,
    applyBestParameters,
    restoreOriginalParameters,
    dismissStopChoice: () =>
      setStopChoiceVisible(false),
    exportRun,
    getRunAnalysis,
    getOriginalParameters,
    clearDisplayedRun,
  };
}

export type OptimisationRunModel = ReturnType<
  typeof useOptimisationRun
>;
