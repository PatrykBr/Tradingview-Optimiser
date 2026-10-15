import {
  isOptimiserErrorCode,
} from '../errors';
import type {
  NextTrial,
  TrialResult,
} from '../protocol/types';

export interface StudyTrialFailure {
  reason: string;
  aborted: boolean;
  fatal: boolean;
}

interface StudyTrialTransport {
  submitResult(
    result: TrialResult,
  ): Promise<void>;
  submitFailure(
    trial: NextTrial,
    reason: string,
  ): Promise<void>;
  stopRun(runId: string): Promise<void>;
}

interface StudyTrialRunnerOptions {
  runId: string;
  evaluate(
    trial: NextTrial,
    signal: AbortSignal,
  ): Promise<TrialResult>;
  transport: StudyTrialTransport;
  signal?: AbortSignal;
  onSuccess?: (
    trial: NextTrial,
  ) => void;
  onFailure?: (
    failure: StudyTrialFailure,
  ) => void;
  onTransportError?: (
    reason: string,
  ) => void;
  onStaleTrial?: (
    reason: string,
  ) => void;
  onReportError?: (
    error: Error,
  ) => void;
}

export interface StudyTrialRunner {
  enqueue(trial: NextTrial): void;
  cancel(): void;
  dispose(): void;
}

const isAbortError = (
  cause: unknown,
): boolean =>
  cause instanceof DOMException &&
  cause.name === 'AbortError';

const errorMessage = (
  cause: unknown,
): string =>
  isAbortError(cause)
    ? 'Trial cancelled by user'
    : cause instanceof Error
      ? cause.message
      : String(cause);

const isBackendTransportError = (
  cause: unknown,
): boolean =>
  isOptimiserErrorCode(
    cause,
    'BACKEND_DISCONNECTED',
    'REQUEST_TIMEOUT',
    'EXTENSION_CONTEXT_INVALIDATED',
    'EXTENSION_RUNTIME_ERROR',
  );

const isStaleTrialError = (
  cause: unknown,
): boolean =>
  isOptimiserErrorCode(
    cause,
    'STALE_TRIAL',
    'UNKNOWN_RUN',
  );

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
  ) ||
  consecutiveIntegrationFailures >= 3;

export const createStudyTrialRunner = (
  options: StudyTrialRunnerOptions,
): StudyTrialRunner => {
  let currentTrialNumber: number | null =
    null;
  let pendingTrial: NextTrial | null =
    null;
  let controller: AbortController | null =
    null;
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
        await options.transport.stopRun(
          trial.run_id,
        );
      }

      await options.transport.submitFailure(
        trial,
        reason,
      );
      return true;
    } catch (cause) {
      const message = errorMessage(cause);

      if (isBackendTransportError(cause)) {
        options.onTransportError?.(message);
      } else if (isStaleTrialError(cause)) {
        options.onStaleTrial?.(message);
      } else {
        options.onReportError?.(
          cause instanceof Error
            ? cause
            : new Error(message),
        );
      }

      return false;
    }
  };

  const execute = async (
    trial: NextTrial,
  ): Promise<void> => {
    if (
      disposed ||
      trial.run_id !== options.runId
    ) {
      return;
    }

    currentTrialNumber =
      trial.trial_number;
    controller = new AbortController();

    try {
      const result =
        await options.evaluate(
          trial,
          controller.signal,
        );

      await options.transport.submitResult(
        result,
      );

      consecutiveIntegrationFailures = 0;
      options.onSuccess?.(trial);
    } catch (cause) {
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

      const runtimeError =
        isOptimiserErrorCode(
          cause,
          'TV_STRATEGY_RUNTIME',
        );

      if (
        !runtimeError &&
        !aborted
      ) {
        consecutiveIntegrationFailures += 1;
      }

      const fatal =
        isFatalIntegrationFailure(
          cause,
          consecutiveIntegrationFailures,
        );

      if (fatal || aborted) {
        pendingTrial = null;
      }

      const reported =
        await reportFailure(
          trial,
          reason,
          fatal,
        );

      if (reported) {
        options.onFailure?.({
          reason,
          aborted,
          fatal,
        });
      }
    } finally {
      if (
        currentTrialNumber ===
        trial.trial_number
      ) {
        currentTrialNumber = null;
      }

      controller = null;

      const next = pendingTrial;
      pendingTrial = null;

      if (
        next &&
        !disposed &&
        !options.signal?.aborted
      ) {
        queueMicrotask(() => {
          void execute(next);
        });
      }
    }
  };

  const enqueue = (
    trial: NextTrial,
  ) => {
    if (
      disposed ||
      options.signal?.aborted ||
      trial.run_id !== options.runId
    ) {
      return;
    }

    if (
      currentTrialNumber ===
        trial.trial_number ||
      pendingTrial?.trial_number ===
        trial.trial_number
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

  options.signal?.addEventListener(
    'abort',
    externalAbort,
    { once: true },
  );

  return {
    enqueue,
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel();
      options.signal?.removeEventListener(
        'abort',
        externalAbort,
      );
    },
  };
};
