import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  OptimiserError,
  combineFailures,
  isOptimiserErrorCode,
  toOptimiserError,
} from '../../lib/errors';
import { subscribeMessages, type BackgroundMessage } from '../../lib/messages';
import { runAuxiliaryStudy } from '../../lib/optimisation/auxiliary-study-runner';
import { buildRunExport } from '../../lib/optimisation/export';
import { isTerminalStatus, mergeRunUpdate } from '../../lib/optimisation/run-progress';
import {
  createStudyTrialRunner,
  evaluateOptimisationTrial,
  type StudyTrialRunner,
  type TrialExecutionUpdate,
} from '../../lib/optimisation/study-trial-runner';
import {
  clearActiveRun,
  finishActiveRun,
  loadActiveRun,
  loadLastRun,
  saveActiveRun,
  updateActiveRunProgress,
  type PersistedOptimisationRun,
} from '../../lib/optimisation/storage';
import type { CreateRun, RunAnalysis, RunProgress } from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import { useBackendConnection } from './useBackendConnection';
import type { PreparedOptimisationRun } from './useStrategyConfiguration';

interface CompatibilityWatchdog {
  status: 'idle' | 'healthy' | 'failed';
  lastSuccessfulTrialAt: number | null;
  lastFailure: string | null;
}

interface UseOptimisationRunOptions {
  adapter: TradingViewAdapter;
  prepareRun: () => Promise<PreparedOptimisationRun>;
  restorePersistedRun: (candidate: PersistedOptimisationRun) => Promise<string>;
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
  const { connected, pairingRequired, sendRequest } = backend;

  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [runConfig, setRunConfig] = useState<CreateRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [currentTrial, setCurrentTrial] = useState<TrialExecutionUpdate | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<PersistedOptimisationRun | null>(null);
  const [stopChoiceVisible, setStopChoiceVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watchdog, setWatchdog] = useState<CompatibilityWatchdog>({
    status: 'idle',
    lastSuccessfulTrialAt: null,
    lastFailure: null,
  });

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());

  const activeRunIdRef = useRef<string | null>(null);
  const trialRunnerRef = useRef<StudyTrialRunner | null>(null);
  const progressRef = useRef<RunProgress | null>(null);
  const finishingRunIdRef = useRef<string | null>(null);
  const recoveringBackendRef = useRef(false);
  const runRef = useRef<PersistedOptimisationRun | null>(null);

  useEffect(
    () => () => {
      trialRunnerRef.current?.dispose();
    },
    [],
  );

  const persistLifecycle = useCallback(
    async (patch: Partial<Pick<PersistedOptimisationRun, 'intent' | 'phase'>>) => {
      const current = runRef.current;

      if (!current || current.config.run_id !== activeRunIdRef.current) {
        throw new Error('Active optimisation lifecycle state is missing');
      }

      const next = {
        ...current,
        ...patch,
      };

      await saveActiveRun(next);
      runRef.current = next;
    },
    [],
  );

  const clearActiveState = useCallback(async () => {
    await clearActiveRun();
    runRef.current = null;
    activeRunIdRef.current = null;
    trialRunnerRef.current?.dispose();
    trialRunnerRef.current = null;
    progressRef.current = null;
    finishingRunIdRef.current = null;
    setActiveRunId(null);
    setProgress(null);
    setRunConfig(null);
    setCurrentTrial(null);
    setStartedAt(null);
    setFinishedAt(null);
  }, []);

  const assertCompatibility = useCallback(
    async (strategyId: string, config: CreateRun) => {
      const reason = await adapter.compatibilityFailureReason(strategyId, config);

      if (reason) {
        setWatchdog({
          status: 'failed',
          lastSuccessfulTrialAt: null,
          lastFailure: reason,
        });

        throw new OptimiserError(
          'TV_CONTEXT_CHANGED',
          'SAFETY: TradingView compatibility pre-flight failed: ' + reason,
        );
      }

      setWatchdog({
        status: 'healthy',
        lastSuccessfulTrialAt: null,
        lastFailure: null,
      });
    },
    [adapter],
  );

  const recoverBackendRun = useCallback(async () => {
    const persisted = runRef.current;
    const runId = activeRunIdRef.current;

    if (!runId || !persisted || recoveringBackendRef.current) {
      return;
    }

    recoveringBackendRef.current = true;

    try {
      if (persisted.intent === 'stopped') {
        await sendRequest({
          type: 'ABORT_RUN',
          payload: {
            run_id: runId,
            reason: 'Retrying a previously requested user stop',
          },
        });
        return;
      }

      await sendRequest({
        type: 'CREATE_RUN',
        payload: persisted.config,
      });
      await sendRequest({
        type: 'START_RUN',
        payload: { run_id: runId },
      });
      await persistLifecycle({
        phase: 'running',
      });
    } catch (cause) {
      setError('Could not recover the active optimisation: ' + toOptimiserError(cause).message);
    } finally {
      recoveringBackendRef.current = false;
    }
  }, [persistLifecycle, sendRequest, setError]);

  const configureTrialRunner = useCallback(
    (strategyId: string, config: CreateRun, originalParameters: Record<string, unknown> | null) => {
      trialRunnerRef.current?.dispose();

      trialRunnerRef.current = createStudyTrialRunner({
        runId: config.run_id,
        evaluate: (trial, signal) =>
          evaluateOptimisationTrial({
            adapter,
            strategyId,
            config,
            trial,
            originalParameters,
            signal,
            onPhase: setCurrentTrial,
          }),
        sendRequest,
        onSuccess: () => {
          setWatchdog({
            status: 'healthy',
            lastSuccessfulTrialAt: Date.now(),
            lastFailure: null,
          });
        },
        onFailure: (failure) => {
          if (failure.fatal) {
            setWatchdog((current) => ({
              status: 'failed',
              lastSuccessfulTrialAt: current.lastSuccessfulTrialAt,
              lastFailure: failure.reason,
            }));
          }

          if (!failure.aborted) {
            setError(failure.reason);
          }
        },
        onTransportError: () => {
          setError(
            'The backend disconnected. The optimiser saved the run and will recover it when the backend reconnects.',
          );
        },
        onReportError: (error) => {
          setError(error.message);
        },
      });
    },
    [adapter, sendRequest, setError],
  );

  const startBackendRun = useCallback(
    async (persisted: PersistedOptimisationRun) => {
      let created = false;

      try {
        await sendRequest({
          type: 'CREATE_RUN',
          payload: persisted.config,
        });
        created = true;

        await sendRequest({
          type: 'START_RUN',
          payload: {
            run_id: persisted.config.run_id,
          },
        });

        await persistLifecycle({
          phase: 'running',
        });
      } catch (cause) {
        const error = toOptimiserError(cause, 'RUN_START_FAILED');

        if (error.retryable) {
          throw new OptimiserError(
            error.code,
            error.message +
              '. The optimiser saved the run and will recover it when the backend reconnects.',
            true,
          );
        }

        if (created) {
          try {
            await sendRequest({
              type: 'ABORT_RUN',
              payload: {
                run_id: persisted.config.run_id,
                reason: 'Rolling back a failed optimisation start',
              },
            });
            await sendRequest({
              type: 'DELETE_RUN',
              payload: {
                run_id: persisted.config.run_id,
              },
            });
          } catch (rollbackFailure) {
            if (!isOptimiserErrorCode(rollbackFailure, 'UNKNOWN_RUN')) {
              const rollbackError = combineFailures(
                error,
                rollbackFailure,
                'Optimisation start failed and backend rollback also failed',
              );

              try {
                await persistLifecycle({
                  intent: 'stopped',
                  phase: 'stopping',
                });
              } catch (persistenceFailure) {
                throw combineFailures(
                  rollbackError,
                  persistenceFailure,
                  'Optimisation rollback failed and its recovery state could not be persisted',
                );
              }

              throw rollbackError;
            }
          }
        }

        try {
          await clearActiveState();
        } catch (cleanupFailure) {
          throw combineFailures(
            error,
            cleanupFailure,
            'Optimisation start failed and local cleanup also failed',
          );
        }

        throw error;
      }
    },
    [clearActiveState, persistLifecycle, sendRequest],
  );

  const activateRun = useCallback(
    async (persisted: PersistedOptimisationRun) => {
      // Persist first: a failed write must leave recovery available and send no backend commands.
      await saveActiveRun(persisted);
      runRef.current = persisted;
      activeRunIdRef.current = persisted.config.run_id;
      configureTrialRunner(persisted.strategyId, persisted.config, persisted.originalParameters);
      setRunConfig(persisted.config);
      setStartedAt(persisted.startedAt);
      setFinishedAt(null);
      setActiveRunId(persisted.config.run_id);
      progressRef.current = persisted.lastProgress ?? null;
      finishingRunIdRef.current = null;
      setProgress(progressRef.current);
      setCurrentTrial(null);
      setResumeCandidate(null);
      setStopChoiceVisible(false);
      await startBackendRun(persisted);
    },
    [configureTrialRunner, startBackendRun],
  );

  const beginPreparedRun = useCallback(
    async (prepared: PreparedOptimisationRun) => {
      await assertCompatibility(prepared.strategyId, prepared.config);

      const now = Date.now();

      const persisted: PersistedOptimisationRun = {
        version: 2,
        config: prepared.config,
        strategyId: prepared.strategyId,
        originalParameters: prepared.originalParameters,
        startedAt: now,
        intent: 'running',
        phase: 'starting',
        environment: {
          extensionVersion: browser.runtime.getManifest().version,
          ...(backend.backendVersion
            ? {
                backendVersion: backend.backendVersion,
              }
            : {}),
          ...(backend.optunaVersion
            ? {
                optunaVersion: backend.optunaVersion,
              }
            : {}),
        },
      };

      await activateRun(persisted);
    },
    [assertCompatibility, backend.backendVersion, backend.optunaVersion, activateRun],
  );

  const assertBackendReady = useCallback(() => {
    if (connected) return;

    throw new Error(
      pairingRequired
        ? 'Pair the extension with the backend first'
        : 'Start the local backend before optimising',
    );
  }, [connected, pairingRequired]);

  const startOptimisation = useCallback(
    async (prepare = prepareRun) => {
      setError(undefined);
      setBusy(true);
      setStopChoiceVisible(false);
      try {
        assertBackendReady();
        await beginPreparedRun(await prepare());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [assertBackendReady, beginPreparedRun, prepareRun, setError],
  );

  const resumeOptimisation = useCallback(async () => {
    const candidate = resumeCandidate;
    if (!candidate) return;

    setBusy(true);
    setError(undefined);
    setStopChoiceVisible(false);

    try {
      assertBackendReady();

      const strategyId = await restorePersistedRun(candidate);

      await adapter.assertRunContext(strategyId, candidate.config, candidate.originalParameters);
      await assertCompatibility(strategyId, candidate.config);

      const persisted: PersistedOptimisationRun = {
        ...candidate,
        version: 2,
        strategyId,
        intent: 'running',
        phase: 'starting',
      };

      await activateRun(persisted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    adapter,
    assertBackendReady,
    assertCompatibility,
    activateRun,
    restorePersistedRun,
    resumeCandidate,
    setError,
  ]);

  const discardResumeCandidate = useCallback(async () => {
    await clearActiveState();
    setResumeCandidate(null);
    setWatchdog({
      status: 'idle',
      lastSuccessfulTrialAt: null,
      lastFailure: null,
    });
  }, [clearActiveState]);

  const stopOptimisation = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (!runId) return;

    setError(undefined);

    let persistenceFailure: unknown | undefined;

    try {
      await persistLifecycle({
        intent: 'stopped',
        phase: 'stopping',
      });
    } catch (cause) {
      persistenceFailure = cause;
    }

    trialRunnerRef.current?.cancel();

    try {
      await sendRequest({
        type: 'ABORT_RUN',
        payload: {
          run_id: runId,
          reason: 'Optimisation stopped by user',
        },
      });

      if (persistenceFailure !== undefined) {
        setError(
          'The backend run was stopped, but the local stop state could not be persisted: ' +
            toOptimiserError(persistenceFailure).message,
        );
      }
    } catch (cause) {
      const error = toOptimiserError(cause);

      if (persistenceFailure !== undefined) {
        setError(
          combineFailures(
            error,
            persistenceFailure,
            'The stop request failed and could not be persisted for recovery',
          ).message,
        );
        return;
      }

      setError(
        error.retryable
          ? error.message +
              '. Your stop request is saved and will be retried when the backend reconnects.'
          : error.message,
      );
    }
  }, [persistLifecycle, sendRequest, setError]);

  const applyParameters = useCallback(
    async (parameters: Record<string, unknown>) => {
      const strategyId = selectedStrategyId;

      if (!strategyId) {
        throw new Error('No TradingView strategy is selected');
      }

      await adapter.applyParameters(strategyId, parameters);
    },
    [adapter, selectedStrategyId],
  );

  const applyBestParameters = useCallback(async () => {
    if (!progress?.best) return;

    setBusy(true);
    setError(undefined);

    try {
      await applyParameters(progress.best.parameters);
      setStopChoiceVisible(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [applyParameters, progress, setError]);

  const restoreOriginalParameters = useCallback(async () => {
    const originalParameters = runRef.current?.originalParameters;
    if (!originalParameters) {
      return;
    }

    setBusy(true);
    setError(undefined);

    try {
      await applyParameters(originalParameters);
      setStopChoiceVisible(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [applyParameters, setError]);

  const runAuxiliaryOptimisation = useCallback(
    async (
      config: CreateRun,
      strategyId: string,
      originalParameters: Record<string, unknown> | null,
      signal?: AbortSignal,
      onPhase?: (update: TrialExecutionUpdate) => void,
      onProgress?: (progress: RunProgress) => void,
    ): Promise<RunProgress> =>
      runAuxiliaryStudy({
        adapter,
        strategyId,
        config,
        originalParameters,
        ...(signal ? { signal } : {}),
        ...(onPhase ? { onPhase } : {}),
        ...(onProgress ? { onProgress } : {}),
        transport: {
          request: sendRequest,
          subscribe: subscribeMessages,
        },
      }),
    [adapter, sendRequest],
  );

  const getRunAnalysis = useCallback(async (): Promise<RunAnalysis | null> => {
    if (!runConfig || !connected) return null;

    return sendRequest({
      type: 'GET_RUN_ANALYSIS',
      payload: {
        run_id: runConfig.run_id,
        config: runConfig,
      },
    });
  }, [connected, runConfig, sendRequest]);

  const getOriginalParameters = useCallback(
    (): Record<string, unknown> | null =>
      runRef.current ? { ...runRef.current.originalParameters } : null,
    [],
  );

  const exportRun = useCallback(
    async (format: 'csv' | 'json') => {
      if (!runConfig || !progress) return;

      await sendRequest({
        type: 'EXPORT_RESULTS',
        payload: buildRunExport(runConfig, progress, format),
      });
    },
    [progress, runConfig, sendRequest],
  );

  const clearDisplayedRun = useCallback(() => {
    if (activeRunIdRef.current) return;

    runRef.current = null;
    progressRef.current = null;
    finishingRunIdRef.current = null;
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
    let cancelled = false;
    const initialisePersistedRun = async () => {
      const saved = await loadActiveRun();
      if (cancelled || runRef.current) return;
      if (saved) {
        runRef.current = saved;

        if (saved.intent === 'stopped') {
          activeRunIdRef.current = saved.config.run_id;
        }

        setResumeCandidate(saved);
        progressRef.current = saved.lastProgress ?? null;
        setProgress(saved.lastProgress ?? null);
        setRunConfig(saved.config);
        setStartedAt(saved.startedAt);
        setFinishedAt(null);
        return;
      }

      const last = await loadLastRun();
      if (cancelled || runRef.current) return;
      if (last?.lastProgress) {
        runRef.current = last;
        progressRef.current = last.lastProgress;
        setProgress(last.lastProgress);
        setRunConfig(last.config);
        setStartedAt(last.startedAt);
        setFinishedAt(last.finishedAt ?? null);
      }
    };

    void initialisePersistedRun().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  useEffect(() => {
    if (!connected || !activeRunIdRef.current) {
      return;
    }

    queueMicrotask(() => {
      void recoverBackendRun();
    });
  }, [connected, recoverBackendRun, resumeCandidate]);

  const acceptProgress = useCallback(
    (nextProgress: RunProgress) => {
      progressRef.current = nextProgress;

      if (!isTerminalStatus(nextProgress.status)) {
        setProgress(nextProgress);
        void updateActiveRunProgress(nextProgress).catch((cause) => {
          setError(
            'The optimisation is running, but its recovery checkpoint could not be saved: ' +
              toOptimiserError(cause).message,
          );
        });
        return;
      }

      if (finishingRunIdRef.current === nextProgress.run_id) {
        return;
      }
      finishingRunIdRef.current = nextProgress.run_id;

      const finishedRunId = nextProgress.run_id;

      void (async () => {
        try {
          await finishActiveRun(nextProgress);
        } catch (cause) {
          finishingRunIdRef.current = null;
          setError(
            'The run finished, but its final state could not be persisted: ' +
              toOptimiserError(cause).message,
          );
          return;
        }

        activeRunIdRef.current = null;
        trialRunnerRef.current?.dispose();
        trialRunnerRef.current = null;
        setProgress(nextProgress);
        setFinishedAt(Date.now());
        setActiveRunId(null);
        setCurrentTrial(null);

        if (nextProgress.status === 'stopped') {
          setStopChoiceVisible(true);
        }

        try {
          await sendRequest({
            type: 'CLEAR_RUN_OWNER',
            payload: {
              runId: finishedRunId,
            },
          });
        } catch (cause) {
          setError(
            'The run finished safely, but background ownership cleanup failed: ' +
              toOptimiserError(cause).message,
          );
        }
      })();
    },
    [sendRequest, setError],
  );

  useEffect(() => {
    const listener = (message: BackgroundMessage) => {
      if (message.type === 'RUN_PROGRESS') {
        if (message.progress.run_id !== activeRunIdRef.current) {
          return;
        }

        acceptProgress(message.progress);
        return;
      }

      if (message.type === 'RUN_UPDATE') {
        if (message.update.run_id !== activeRunIdRef.current) {
          return;
        }

        acceptProgress(mergeRunUpdate(progressRef.current, message.update));
        return;
      }

      if (message.type === 'NEXT_TRIAL' && message.trial.run_id === activeRunIdRef.current) {
        trialRunnerRef.current?.enqueue(message.trial);
      }
    };

    return subscribeMessages(listener);
  }, [acceptProgress]);

  useEffect(() => {
    if (activeRunId === null) return;

    const timer = setInterval(() => {
      setClock(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [activeRunId]);

  const elapsedMs =
    startedAt === null ? null : (activeRunId !== null ? clock : (finishedAt ?? clock)) - startedAt;

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
    resumeOptimisation,
    discardResumeCandidate,
    stopOptimisation,
    applyBestParameters,
    restoreOriginalParameters,
    dismissStopChoice: () => setStopChoiceVisible(false),
    exportRun,
    getRunAnalysis,
    getOriginalParameters,
    runAuxiliaryOptimisation,
    clearDisplayedRun,
  };
}

export type OptimisationRunModel = ReturnType<typeof useOptimisationRun>;
