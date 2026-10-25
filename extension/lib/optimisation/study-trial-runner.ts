import { errorMessage as describeError, isOptimiserErrorCode } from '../errors';
import type {
  BacktestRange,
  BackendCommand,
  CreateRun,
  NextTrial,
  TrialResult,
} from '../protocol/types';

export interface StudyTrialFailure {
  reason: string;
  aborted: boolean;
  fatal: boolean;
}

interface StudyTrialRunnerOptions {
  runId: string;
  evaluate(trial: NextTrial, signal: AbortSignal): Promise<TrialResult>;
  sendRequest(command: BackendCommand): Promise<unknown>;
  signal?: AbortSignal;
  onSuccess?: (trial: NextTrial) => void;
  onFailure?: (failure: StudyTrialFailure) => void;
  onTransportError?: (reason: string) => void;
  onStaleTrial?: (reason: string) => void;
  onReportError?: (error: Error) => void;
}

export interface StudyTrialRunner {
  enqueue(trial: NextTrial): void;
  cancel(): void;
  dispose(): void;
}

const isAbortError = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === 'AbortError';

const errorMessage = (cause: unknown): string =>
  isAbortError(cause) ? 'Trial cancelled by user' : describeError(cause);

const isBackendTransportError = (cause: unknown): boolean =>
  isOptimiserErrorCode(
    cause,
    'BACKEND_DISCONNECTED',
    'REQUEST_TIMEOUT',
    'EXTENSION_CONTEXT_INVALIDATED',
    'EXTENSION_RUNTIME_ERROR',
  );

const isStaleTrialError = (cause: unknown): boolean =>
  isOptimiserErrorCode(cause, 'STALE_TRIAL', 'UNKNOWN_RUN');

const isFatalIntegrationFailure = (
  cause: unknown,
  consecutiveIntegrationFailures: number,
): boolean =>
  isOptimiserErrorCode(
    cause,
    'TV_CONTEXT_CHANGED',
    'TV_STRATEGY_TESTER_UNAVAILABLE',
    'TV_DEEP_BACKTEST_UNAVAILABLE',
    'TV_DEEP_REPORT_UNAVAILABLE',
    'TV_REPORT_PARSE_FAILED',
    'TV_REPORT_SOURCE_UNAVAILABLE',
    'TV_METRIC_SOURCE_CHANGED',
  ) || consecutiveIntegrationFailures >= 3;

export const createStudyTrialRunner = (options: StudyTrialRunnerOptions): StudyTrialRunner => {
  let currentTrialNumber: number | null = null;
  let pendingTrial: NextTrial | null = null;
  let controller: AbortController | null = null;
  let disposed = false;
  let consecutiveIntegrationFailures = 0;

  const cancel = () => {
    pendingTrial = null;
    controller?.abort();
  };

  const reportFailure = async (
    trial: NextTrial,
    reason: string,
    fatal: boolean,
  ): Promise<boolean> => {
    try {
      if (fatal) {
        await options.sendRequest({ type: 'STOP_RUN', payload: { run_id: trial.run_id } });
      }

      await options.sendRequest({
        type: 'TRIAL_FAILED',
        payload: { run_id: trial.run_id, trial_number: trial.trial_number, reason },
      });
      return true;
    } catch (cause) {
      const message = errorMessage(cause);

      if (isBackendTransportError(cause)) {
        options.onTransportError?.(message);
      } else if (isStaleTrialError(cause)) {
        options.onStaleTrial?.(message);
      } else {
        options.onReportError?.(cause instanceof Error ? cause : new Error(message));
      }

      return false;
    }
  };

  const handleTrialFailure = async (trial: NextTrial, cause: unknown): Promise<void> => {
    const reason = errorMessage(cause);
    const aborted = isAbortError(cause);

    if (isBackendTransportError(cause)) {
      pendingTrial = null;
      options.onTransportError?.(reason);
      return;
    }

    if (isStaleTrialError(cause)) {
      pendingTrial = null;
      options.onStaleTrial?.(reason);
      return;
    }

    const runtimeError = isOptimiserErrorCode(cause, 'TV_STRATEGY_RUNTIME');

    if (!runtimeError && !aborted) {
      consecutiveIntegrationFailures += 1;
    }

    const fatal = isFatalIntegrationFailure(cause, consecutiveIntegrationFailures);

    if (fatal || aborted) {
      pendingTrial = null;
    }

    const reported = await reportFailure(trial, reason, fatal);

    if (reported) {
      options.onFailure?.({
        reason,
        aborted,
        fatal,
      });
    }
  };

  const execute = async (trial: NextTrial): Promise<void> => {
    if (disposed || trial.run_id !== options.runId) {
      return;
    }

    currentTrialNumber = trial.trial_number;
    controller = new AbortController();

    try {
      const result = await options.evaluate(trial, controller.signal);

      await options.sendRequest({ type: 'TRIAL_RESULT', payload: result });

      consecutiveIntegrationFailures = 0;
      options.onSuccess?.(trial);
    } catch (cause) {
      await handleTrialFailure(trial, cause);
    } finally {
      if (currentTrialNumber === trial.trial_number) {
        currentTrialNumber = null;
      }

      controller = null;

      const next = pendingTrial;
      pendingTrial = null;

      if (next && !disposed && !options.signal?.aborted) {
        queueMicrotask(() => {
          void execute(next);
        });
      }
    }
  };

  const enqueue = (trial: NextTrial) => {
    if (disposed || options.signal?.aborted || trial.run_id !== options.runId) {
      return;
    }

    if (
      currentTrialNumber === trial.trial_number ||
      pendingTrial?.trial_number === trial.trial_number
    ) {
      return;
    }

    if (currentTrialNumber !== null) {
      pendingTrial = trial;
      return;
    }

    void execute(trial);
  };

  const externalAbort = () => {
    cancel();
  };

  options.signal?.addEventListener('abort', externalAbort, { once: true });

  return {
    enqueue,
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel();
      options.signal?.removeEventListener('abort', externalAbort);
    },
  };
};

export interface OptimisationTrialAdapter {
  assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters: Record<string, unknown> | null,
  ): Promise<void>;
  evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: BacktestRange | null,
    signal?: AbortSignal,
  ): Promise<Record<string, number>>;
}

type TrialExecutionPhase = 'checking' | 'recalculating' | 'submitting';

export interface TrialExecutionUpdate {
  number: number;
  parameters: Record<string, unknown>;
  phase: TrialExecutionPhase;
}

interface EvaluateTrialRequest {
  adapter: OptimisationTrialAdapter;
  strategyId: string;
  config: CreateRun;
  trial: NextTrial;
  originalParameters: Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (update: TrialExecutionUpdate) => void;
}

export const evaluateOptimisationTrial = async (
  request: EvaluateTrialRequest,
): Promise<TrialResult> => {
  request.signal?.throwIfAborted();
  const startedAt = Date.now();

  request.onPhase?.({
    number: request.trial.trial_number,
    parameters: request.trial.parameters,
    phase: 'checking',
  });

  await request.adapter.assertRunContext(
    request.strategyId,
    request.config,
    request.originalParameters,
  );
  const contextPreMs = Date.now() - startedAt;
  request.signal?.throwIfAborted();

  request.onPhase?.({
    number: request.trial.trial_number,
    parameters: request.trial.parameters,
    phase: 'recalculating',
  });

  const evaluationStartedAt = Date.now();
  const metrics = await request.adapter.evaluateParameters(
    request.strategyId,
    request.trial.parameters,
    request.config.backtest_range ?? null,
    request.signal,
  );
  const evaluationMs = Date.now() - evaluationStartedAt;
  request.signal?.throwIfAborted();

  const contextPostStartedAt = Date.now();
  await request.adapter.assertRunContext(
    request.strategyId,
    request.config,
    request.originalParameters,
  );
  const contextPostMs = Date.now() - contextPostStartedAt;
  request.signal?.throwIfAborted();

  request.onPhase?.({
    number: request.trial.trial_number,
    parameters: request.trial.parameters,
    phase: 'submitting',
  });

  return {
    run_id: request.trial.run_id,
    trial_number: request.trial.trial_number,
    metrics: {
      ...metrics,
      'tvopt.contextPreMs': contextPreMs,
      'tvopt.evaluationMs': evaluationMs,
      'tvopt.contextPostMs': contextPostMs,
    },
    duration_ms: Date.now() - startedAt,
  };
};
