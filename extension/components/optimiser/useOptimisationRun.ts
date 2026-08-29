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
  runAuxiliaryStudy,
} from '../../lib/optimisation/auxiliary-study-runner';
import {
  buildRunExport,
} from '../../lib/optimisation/export';
import {
  compatibilityFailureReason,
} from '../../lib/optimisation/run-compatibility';
import {
  createStudyTrialRunner,
  type StudyTrialRunner,
} from '../../lib/optimisation/study-trial-runner';
import {
  evaluateOptimisationTrial,
  type TrialExecutionUpdate,
} from '../../lib/optimisation/trial-executor';
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
  RunAnalysis,
  RunProgress,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import { useBackendConnection } from './useBackendConnection';
import type { PreparedOptimisationRun } from './useStrategyConfiguration';

type TrialExecution = TrialExecutionUpdate;

export interface CompatibilityWatchdog {
  status: 'idle' | 'healthy' | 'failed';
  lastSuccessfulTrialAt: number | null;
  lastFailure: string | null;
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
  const [watchdog, setWatchdog] =
    useState<CompatibilityWatchdog>({
      status: 'idle',
      lastSuccessfulTrialAt: null,
      lastFailure: null,
    });

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
  const trialRunnerRef =
    useRef<StudyTrialRunner | null>(null);
  const recoveringBackendRef = useRef(false);

  const assertCompatibility =
    useCallback(
      async (
        strategyId: string,
        config: CreateRun,
      ) => {
        const reason =
          await compatibilityFailureReason(
            adapter,
            strategyId,
            config,
          );

        if (reason) {
          setWatchdog({
            status: 'failed',
            lastSuccessfulTrialAt:
              null,
            lastFailure: reason,
          });

          throw new Error(
            'SAFETY: TradingView compatibility pre-flight failed: ' +
              reason,
          );
        }

        setWatchdog({
          status: 'healthy',
          lastSuccessfulTrialAt:
            null,
          lastFailure: null,
        });
      },
      [adapter],
    );

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

  const configureTrialRunner =
    useCallback(
      (
        strategyId: string,
        config: CreateRun,
        originalParameters:
          Record<string, unknown> | null,
      ) => {
        trialRunnerRef.current?.dispose();

        trialRunnerRef.current =
          createStudyTrialRunner({
            runId: config.run_id,
            evaluate: (
              trial,
              signal,
            ) =>
              evaluateOptimisationTrial({
                adapter,
                strategyId,
                config,
                trial,
                originalParameters,
                signal,
                onPhase:
                  setCurrentTrial,
              }),
            transport: {
              submitResult: async (
                result,
              ) => {
                await sendRequest({
                  type: 'TRIAL_RESULT',
                  payload: result,
                });
              },
              submitFailure: async (
                trial,
                reason,
              ) => {
                await sendRequest({
                  type: 'TRIAL_FAILED',
                  payload: {
                    runId:
                      trial.run_id,
                    trialNumber:
                      trial.trial_number,
                    reason,
                  },
                });
              },
              stopRun: async (
                runId,
              ) => {
                await sendRequest({
                  type: 'STOP_RUN',
                  payload: {
                    runId,
                  },
                });
              },
            },
            onSuccess: () => {
              setWatchdog({
                status: 'healthy',
                lastSuccessfulTrialAt:
                  Date.now(),
                lastFailure: null,
              });
            },
            onFailure: (
              failure,
            ) => {
              if (failure.fatal) {
                setWatchdog(
                  (current) => ({
                    status: 'failed',
                    lastSuccessfulTrialAt:
                      current.lastSuccessfulTrialAt,
                    lastFailure:
                      failure.reason,
                  }),
                );
              }

              if (!failure.aborted) {
                setError(
                  failure.reason,
                );
              }
            },
            onTransportError: () => {
              setError(
                'Backend connection was interrupted. The run is saved and will recover when the backend reconnects.',
              );
            },
            onReportError: (
              error,
            ) => {
              setError(error.message);
            },
          });
      },
      [
        adapter,
        sendRequest,
        setError,
      ],
    );

  const beginPreparedRun = useCallback(
    async (
      prepared: PreparedOptimisationRun,
    ) => {
      await assertCompatibility(
        prepared.strategyId,
        prepared.config,
      );

      const now = Date.now();

      const persisted: PersistedOptimisationRun = {
        version: 1,
        config: prepared.config,
        strategyId: prepared.strategyId,
        originalParameters:
          prepared.originalParameters,
        startedAt: now,
        environment: {
          extensionVersion:
            browser.runtime
              .getManifest().version,
          ...(backend.backendVersion
            ? {
                backendVersion:
                  backend.backendVersion,
              }
            : {}),
          ...(backend.optunaVersion
            ? {
                optunaVersion:
                  backend.optunaVersion,
              }
            : {}),
        },
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

      configureTrialRunner(
        prepared.strategyId,
        prepared.config,
        prepared.originalParameters,
      );

      setRunConfig(prepared.config);
      setStartedAt(now);
      setFinishedAt(null);
      setActiveRunId(
        prepared.config.run_id,
      );
      setProgress(null);
      setCurrentTrial(null);
      setResumeCandidate(null);
      setStopChoiceVisible(false);

      await sendRequest({
        type: 'CREATE_RUN',
        payload: prepared.config,
      });
      await sendRequest({
        type: 'START_RUN',
        payload: {
          runId:
            prepared.config.run_id,
        },
      });
    },
    [
      assertCompatibility,
      backend.backendVersion,
      backend.optunaVersion,
      configureTrialRunner,
      sendRequest,
    ],
  );

  const resetFailedStart =
    useCallback(async () => {
      await clearActiveRun();
      activeRunIdRef.current = null;
      activeStrategyIdRef.current = null;
      activeConfigRef.current = null;
      originalParametersRef.current = null;
      trialRunnerRef.current?.dispose();
      trialRunnerRef.current = null;
      setActiveRunId(null);
    }, []);

  const assertBackendReady =
    useCallback(() => {
      if (connected) return;

      throw new Error(
        pairingRequired
          ? 'Pair the extension with the backend first'
          : 'Start the local FastAPI backend before optimising',
      );
    }, [
      connected,
      pairingRequired,
    ]);

  const startOptimisation =
    useCallback(async () => {
      setError(undefined);
      setBusy(true);
      setStopChoiceVisible(false);

      try {
        assertBackendReady();
        const prepared =
          await prepareRun();
        await beginPreparedRun(
          prepared,
        );
      } catch (cause) {
        await resetFailedStart();
        setError(
          cause instanceof Error
            ? cause.message
            : String(cause),
        );
      } finally {
        setBusy(false);
      }
    }, [
      assertBackendReady,
      beginPreparedRun,
      prepareRun,
      resetFailedStart,
      setError,
    ]);

  const startPreparedOptimisation =
    useCallback(
      async (
        prepared:
          PreparedOptimisationRun,
      ) => {
        setError(undefined);
        setBusy(true);
        setStopChoiceVisible(false);

        try {
          assertBackendReady();
          await beginPreparedRun(
            prepared,
          );
        } catch (cause) {
          await resetFailedStart();
          setError(
            cause instanceof Error
              ? cause.message
              : String(cause),
          );
        } finally {
          setBusy(false);
        }
      },
      [
        assertBackendReady,
        beginPreparedRun,
        resetFailedStart,
        setError,
      ],
    );

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
        await assertCompatibility(
          strategyId,
          candidate.config,
        );

        activeRunIdRef.current =
          candidate.config.run_id;
        activeStrategyIdRef.current =
          strategyId;
        activeConfigRef.current =
          candidate.config;

        configureTrialRunner(
          strategyId,
          candidate.config,
          candidate.originalParameters,
        );

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
      assertCompatibility,
      configureTrialRunner,
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
      setWatchdog({
        status: 'idle',
        lastSuccessfulTrialAt: null,
        lastFailure: null,
      });
    }, []);

  const stopOptimisation =
    useCallback(async () => {
      const runId = activeRunIdRef.current;
      if (!runId) return;

      setError(undefined);

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
        trialRunnerRef.current?.cancel();
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

  const runAuxiliaryOptimisation =
    useCallback(
      async (
        config: CreateRun,
        strategyId: string,
        originalParameters:
          Record<string, unknown> | null,
        signal?: AbortSignal,
        onPhase?: (
          update: TrialExecutionUpdate,
        ) => void,
        onProgress?: (
          progress: RunProgress,
        ) => void,
      ): Promise<RunProgress> =>
        runAuxiliaryStudy({
          adapter,
          strategyId,
          config,
          originalParameters,
          ...(signal ? { signal } : {}),
          ...(onPhase ? { onPhase } : {}),
          ...(onProgress
            ? { onProgress }
            : {}),
          transport: {
            request: sendRequest,
            subscribe: (listener) => {
              const runtimeListener = (
                message: unknown,
              ) => {
                if (
                  message &&
                  typeof message === 'object' &&
                  'type' in message
                ) {
                  listener(
                    message as BackgroundMessage,
                  );
                }
              };

              browser.runtime.onMessage.addListener(
                runtimeListener,
              );

              return () =>
                browser.runtime.onMessage.removeListener(
                  runtimeListener,
                );
            },
          },
        }),
      [adapter, sendRequest],
    );

  const getRunAnalysis = useCallback(
    async (): Promise<RunAnalysis | null> => {
      const runId =
        runConfig?.run_id ??
        progress?.run_id;
      if (!runId || !connected) return null;

      const config = runConfig;
      if (!config) return null;

      return sendRequest<RunAnalysis>({
        type: 'GET_RUN_ANALYSIS',
        payload: {
          runId,
          config,
        },
      });
    },
    [
      connected,
      progress?.run_id,
      runConfig,
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

      await sendRequest({
        type: 'EXPORT_RESULTS',
        payload: buildRunExport(
          runConfig,
          progress,
          format,
        ),
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
    setWatchdog({
      status: 'idle',
      lastSuccessfulTrialAt: null,
      lastFailure: null,
    });
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

        const terminal =
          message.progress.status === 'completed' ||
          message.progress.status === 'stopped' ||
          message.progress.status === 'failed';

        if (!terminal) {
          setProgress(message.progress);
          void updateActiveRunProgress(
            message.progress,
          );
          return;
        }

        const finishedRunId =
          message.progress.run_id;

        void (async () => {
          await finishActiveRun(
            message.progress,
          );

          activeRunIdRef.current = null;
          trialRunnerRef.current?.dispose();
          trialRunnerRef.current = null;
          setProgress(message.progress);
          setFinishedAt(Date.now());
          setActiveRunId(null);
          setCurrentTrial(null);

          if (
            message.progress.status ===
            'stopped'
          ) {
            setStopChoiceVisible(true);
          }

          try {
            await sendRequest({
              type: 'CLEAR_RUN_OWNER',
              payload: {
                runId: finishedRunId,
              },
            });
          } catch {
            // The run itself is already safely persisted locally.
          }
        })();
        return;
      }

      if (message.type === 'NEXT_TRIAL') {
        trialRunnerRef.current?.enqueue(
          message.trial,
        );
      }
    };

    browser.runtime.onMessage.addListener(
      listener,
    );
    return () =>
      browser.runtime.onMessage.removeListener(
        listener,
      );
  }, [sendRequest]);

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
    watchdog,
    setPairingCode: backend.setPairingCode,
    pairBackend: backend.pairBackend,
    startOptimisation,
    startPreparedOptimisation,
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
    runAuxiliaryOptimisation,
    clearDisplayedRun,
  };
}

export type OptimisationRunModel = ReturnType<
  typeof useOptimisationRun
>;
