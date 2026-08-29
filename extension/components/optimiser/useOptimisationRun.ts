import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type {
  BackendState,
  BackgroundMessage,
  ExtensionRequest,
} from '../../lib/messages';
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
  RunProgress,
} from '../../lib/protocol/types';
import type { TradingViewAdapter } from '../../lib/tradingview/adapter';
import { sameChart } from './configuration';
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

const responseError = (response: unknown): string | null => {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const record = response as Record<string, unknown>;
  return record.ok === false &&
    typeof record.error === 'string'
    ? record.error
    : null;
};

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
  const [connected, setConnected] = useState(false);
  const [pairingRequired, setPairingRequired] =
    useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [optunaVersion, setOptunaVersion] =
    useState<string>();

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
  const wasConnectedRef = useRef(false);

  const sendRequest = useCallback(
    async <T,>(
      request: ExtensionRequest,
    ): Promise<T> => {
      const response =
        await browser.runtime.sendMessage(request);
      const message = responseError(response);
      if (message) throw new Error(message);
      return response as T;
    },
    [],
  );

  const applyBackendState = useCallback(
    (state: BackendState) => {
      setConnected(state.connected);
      setPairingRequired(
        state.pairingRequired ?? false,
      );
      setOptunaVersion(state.optunaVersion);
    },
    [],
  );

  const assertRunContext = useCallback(
    async (
      strategyId: string,
      config: CreateRun,
    ) => {
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

      const originalParameters =
        originalParametersRef.current;
      if (originalParameters) {
        const optimisedIds = new Set(
          config.parameters.map(
            (parameter) => parameter.name,
          ),
        );
        const liveInputs =
          await adapter.readStrategyInputs(strategyId);

        for (const input of liveInputs) {
          if (
            optimisedIds.has(input.id) ||
            !(input.id in originalParameters)
          ) {
            continue;
          }

          if (
            JSON.stringify(input.currentValue) !==
            JSON.stringify(
              originalParameters[input.id],
            )
          ) {
            throw new Error(
              'SAFETY: Fixed strategy input "' +
                input.label +
                '" changed during the optimisation.',
            );
          }
        }
      }

      const backtestMode =
        await adapter.getBacktestMode();
      const expectedMode = config.backtest_range
        ? 'deep'
        : 'chart';

      if (backtestMode !== expectedMode) {
        throw new Error(
          'SAFETY: TradingView backtest mode changed during the optimisation.',
        );
      }

      if (
        signature !==
        config.chart.strategy_signature
      ) {
        throw new Error(
          'SAFETY: The TradingView strategy or its input structure changed during the optimisation.',
        );
      }

      const expectedSettingsSignature =
        config.chart.strategy_settings_signature;
      if (expectedSettingsSignature) {
        const liveSettingsSignature =
          await adapter.getStrategySettingsSignature(
            strategyId,
          );

        if (
          liveSettingsSignature !==
          expectedSettingsSignature
        ) {
          throw new Error(
            'SAFETY: TradingView strategy properties changed during the optimisation.',
          );
        }
      }

      if (config.backtest_range) {
        await adapter.assertDeepBacktestRange(
          strategyId,
          config.backtest_range.start_date,
          config.backtest_range.end_date,
        );
      }
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
    }, [connected, sendRequest, setError]);

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

        await assertRunContext(
          strategyId,
          config,
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

        await assertRunContext(
          strategyId,
          config,
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
      assertRunContext,
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

        await assertRunContext(
          strategyId,
          candidate.config,
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
      assertRunContext,
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

  const pairBackend = useCallback(async () => {
    if (!pairingCode.trim()) return;

    setBusy(true);
    setError(undefined);

    try {
      const state =
        await sendRequest<BackendState>({
          type: 'PAIR_BACKEND',
          payload: {
            code: pairingCode.trim(),
          },
        });
      applyBackendState(state);
      setPairingCode('');
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
    applyBackendState,
    pairingCode,
    sendRequest,
    setError,
  ]);

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

    setProgress(null);
    setRunConfig(null);
    setCurrentTrial(null);
    setStartedAt(null);
    setFinishedAt(null);
    setStopChoiceVisible(false);
  }, []);

  useEffect(() => {
    const initialise = async () => {
      const state =
        await sendRequest<BackendState>({
          type: 'GET_BACKEND_STATE',
        });
      applyBackendState(state);

      if (
        !state.connected &&
        !state.pairingRequired
      ) {
        const connectState =
          await sendRequest<BackendState>({
            type: 'BACKEND_CONNECT',
          });
        applyBackendState(connectState);
      }

      const saved = await loadActiveRun();
      if (saved) {
        setResumeCandidate(saved);
        setProgress(
          saved.lastProgress ?? null,
        );
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

    void initialise().catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    });
  }, [
    applyBackendState,
    sendRequest,
    setError,
  ]);

  useEffect(() => {
    const listener = (
      message: BackgroundMessage,
    ) => {
      if (message.type === 'BACKEND_STATE') {
        const previouslyConnected =
          wasConnectedRef.current;
        wasConnectedRef.current =
          message.connected;
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
  }, [
    applyBackendState,
    executeTrial,
    recoverBackendRun,
    sendRequest,
    setError,
  ]);

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
    pairingCode,
    optunaVersion,
    progress,
    runConfig,
    activeRunId,
    currentTrial,
    resumeCandidate,
    stopChoiceVisible,
    busy,
    elapsedMs,
    setPairingCode,
    pairBackend,
    startOptimisation,
    resumeOptimisation,
    discardResumeCandidate,
    stopOptimisation,
    applyBestParameters,
    restoreOriginalParameters,
    dismissStopChoice: () =>
      setStopChoiceVisible(false),
    exportRun,
    clearDisplayedRun,
  };
}

export type OptimisationRunModel = ReturnType<
  typeof useOptimisationRun
>;
