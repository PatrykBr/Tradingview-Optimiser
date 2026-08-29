import type {
  NextTrial,
  TrialResult,
} from '../protocol/types';

export interface StudyTrialFailure {
  reason: string;
  aborted: boolean;
  fatal: boolean;
}

export interface StudyTrialTransport {
  submitResult(
    result: TrialResult,
  ): Promise<void>;
  submitFailure(
    trial: NextTrial,
    reason: string,
  ): Promise<void>;
  stopRun(runId: string): Promise<void>;
}

export interface StudyTrialRunnerOptions {
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
  message: string,
): boolean =>
  /backend (is not connected|connection closed|request timed out)|backend client disconnected/i.test(
    message,
  );

const isStaleTrialError = (
  message: string,
): boolean =>
  /not the outstanding trial|unknown run_id/i.test(
    message,
  );

const isFatalIntegrationFailure = (
  reason: string,
  consecutiveIntegrationFailures: number,
): boolean =>
  reason.startsWith('SAFETY:') ||
  /deep backtesting.*(could not|not available|failed)|could not open tradingview strategy tester/i.test(
    reason,
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

      if (isBackendTransportError(message)) {
        options.onTransportError?.(message);
      } else if (isStaleTrialError(message)) {
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

      if (isBackendTransportError(reason)) {
        pendingTrial = null;
        options.onTransportError?.(reason);
        return;
      }

      if (isStaleTrialError(reason)) {
        pendingTrial = null;
        options.onStaleTrial?.(reason);
        return;
      }

      const runtimeError =
        /strategy runtime error/i.test(
          reason,
        );

      if (
        !runtimeError &&
        !aborted
      ) {
        consecutiveIntegrationFailures += 1;
      }

      const fatal =
        isFatalIntegrationFailure(
          reason,
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
