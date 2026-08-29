import type {
  BackgroundMessage,
  ExtensionRequest,
} from '../messages';
import type {
  CreateRun,
  NextTrial,
  RunProgress,
} from '../protocol/types';
import type {
  TradingViewAdapter,
} from '../tradingview/adapter';
import {
  evaluateOptimisationTrial,
  type TrialExecutionUpdate,
} from './trial-executor';

export interface AuxiliaryStudyTransport {
  request<T = unknown>(
    request: ExtensionRequest,
  ): Promise<T>;
  subscribe(
    listener: (
      message: BackgroundMessage,
    ) => void,
  ): () => void;
}

export interface AuxiliaryStudyRequest {
  transport: AuxiliaryStudyTransport;
  adapter: TradingViewAdapter;
  strategyId: string;
  config: CreateRun;
  originalParameters:
    Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (
    update: TrialExecutionUpdate,
  ) => void;
  onProgress?: (
    progress: RunProgress,
  ) => void;
}

const isTerminal = (
  status: RunProgress['status'],
): boolean =>
  status === 'completed' ||
  status === 'stopped' ||
  status === 'failed';

const isAbortError = (
  cause: unknown,
): boolean =>
  cause instanceof DOMException &&
  cause.name === 'AbortError';

const failureMessage = (
  cause: unknown,
): string =>
  isAbortError(cause)
    ? 'Trial cancelled by user'
    : cause instanceof Error
      ? cause.message
      : String(cause);

export const runAuxiliaryStudy =
  async (
    request: AuxiliaryStudyRequest,
  ): Promise<RunProgress> => {
    if (request.signal?.aborted) {
      throw new DOMException(
        'Operation aborted',
        'AbortError',
      );
    }

    let settled = false;
    let executing = false;
    let pendingTrial: NextTrial | null =
      null;
    let consecutiveIntegrationFailures = 0;

    let resolveProgress:
      | ((
          progress: RunProgress,
        ) => void)
      | null = null;
    let rejectProgress:
      | ((error: Error) => void)
      | null = null;

    const completion =
      new Promise<RunProgress>(
        (resolve, reject) => {
          resolveProgress = resolve;
          rejectProgress = reject;
        },
      );

    const finish = (
      progress: RunProgress,
    ) => {
      if (settled) return;
      settled = true;
      resolveProgress?.(progress);
    };

    const fail = (
      cause: unknown,
    ) => {
      if (settled) return;
      settled = true;
      rejectProgress?.(
        cause instanceof Error
          ? cause
          : new Error(String(cause)),
      );
    };

    const execute = async (
      trial: NextTrial,
    ): Promise<void> => {
      if (
        settled ||
        trial.run_id !==
          request.config.run_id
      ) {
        return;
      }

      if (executing) {
        pendingTrial = trial;
        return;
      }

      executing = true;

      try {
        const result =
          await evaluateOptimisationTrial({
            adapter:
              request.adapter,
            strategyId:
              request.strategyId,
            config:
              request.config,
            trial,
            originalParameters:
              request.originalParameters,
            signal:
              request.signal,
            onPhase:
              request.onPhase,
          });

        await request.transport.request({
          type: 'TRIAL_RESULT',
          payload: result,
        });

        consecutiveIntegrationFailures = 0;
      } catch (cause) {
        const reason =
          failureMessage(cause);
        const abort =
          isAbortError(cause);
        const runtimeError =
          /strategy runtime error/i.test(
            reason,
          );

        if (
          !abort &&
          !runtimeError
        ) {
          consecutiveIntegrationFailures += 1;
        }

        const fatal =
          abort ||
          reason.startsWith('SAFETY:') ||
          /deep backtesting.*(could not|not available|failed)|could not open tradingview strategy tester/i.test(
            reason,
          ) ||
          consecutiveIntegrationFailures >= 3;

        try {
          if (fatal) {
            await request.transport.request({
              type: 'STOP_RUN',
              payload: {
                runId:
                  trial.run_id,
              },
            });
          }

          await request.transport.request({
            type: 'TRIAL_FAILED',
            payload: {
              runId:
                trial.run_id,
              trialNumber:
                trial.trial_number,
              reason,
            },
          });
        } catch (reportFailure) {
          fail(reportFailure);
          return;
        }

        if (
          fatal &&
          !abort
        ) {
          fail(new Error(reason));
        }
      } finally {
        executing = false;

        const next =
          pendingTrial;
        pendingTrial = null;

        if (
          next &&
          !settled
        ) {
          queueMicrotask(() => {
            void execute(next);
          });
        }
      }
    };

    const listener = (
      message: BackgroundMessage,
    ) => {
      if (
        message.type === 'RUN_PROGRESS' &&
        message.progress.run_id ===
          request.config.run_id
      ) {
        request.onProgress?.(
          message.progress,
        );

        if (
          isTerminal(
            message.progress.status,
          )
        ) {
          finish(
            message.progress,
          );
        }
        return;
      }

      if (
        message.type === 'NEXT_TRIAL' &&
        message.trial.run_id ===
          request.config.run_id
      ) {
        void execute(
          message.trial,
        );
      }
    };

    const unsubscribe =
      request.transport.subscribe(
        listener,
      );

    const abortListener = () => {
      void request.transport
        .request({
          type: 'STOP_RUN',
          payload: {
            runId:
              request.config.run_id,
          },
        })
        .catch(() => undefined);
    };

    request.signal?.addEventListener(
      'abort',
      abortListener,
      { once: true },
    );

    try {
      await request.transport.request({
        type: 'REGISTER_RUN_OWNER',
        payload: {
          runId:
            request.config.run_id,
        },
      });

      await request.transport.request({
        type: 'CREATE_RUN',
        payload:
          request.config,
      });

      await request.transport.request({
        type: 'START_RUN',
        payload: {
          runId:
            request.config.run_id,
        },
      });

      return await completion;
    } finally {
      unsubscribe();
      request.signal?.removeEventListener(
        'abort',
        abortListener,
      );

      try {
        await request.transport.request({
          type: 'CLEAR_RUN_OWNER',
          payload: {
            runId:
              request.config.run_id,
          },
        });
      } catch {
        // Owner cleanup is best-effort; the backend study remains persisted.
      }
    }
  };
