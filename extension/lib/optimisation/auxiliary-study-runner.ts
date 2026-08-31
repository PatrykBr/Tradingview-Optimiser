import type {
  BackgroundMessage,
  ExtensionRequest,
} from '../messages';
import type {
  CreateRun,
  RunProgress,
} from '../protocol/types';
import {
  mergeRunUpdate,
} from './run-progress';
import {
  createStudyTrialRunner,
} from './study-trial-runner';
import {
  evaluateOptimisationTrial,
  type OptimisationTrialAdapter,
  type TrialExecutionUpdate,
} from './trial-executor';

export interface AuxiliaryStudyTransport {
  request(
    request: ExtensionRequest,
  ): Promise<unknown>;
  subscribe(
    listener: (
      message: BackgroundMessage,
    ) => void,
  ): () => void;
}

interface AuxiliaryStudyRequest {
  transport: AuxiliaryStudyTransport;
  adapter: OptimisationTrialAdapter;
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
    let latestProgress: RunProgress | null =
      null;
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

    const runner =
      createStudyTrialRunner({
        runId:
          request.config.run_id,
        evaluate: (
          trial,
          signal,
        ) =>
          evaluateOptimisationTrial({
            adapter:
              request.adapter,
            strategyId:
              request.strategyId,
            config:
              request.config,
            trial,
            originalParameters:
              request.originalParameters,
            signal,
            ...(request.onPhase
              ? { onPhase: request.onPhase }
              : {}),
          }),
        transport: {
          submitResult: async (
            result,
          ) => {
            await request.transport.request({
              type: 'TRIAL_RESULT',
              payload: result,
            });
          },
          submitFailure: async (
            trial,
            reason,
          ) => {
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
          },
          stopRun: async (
            runId,
          ) => {
            await request.transport.request({
              type: 'STOP_RUN',
              payload: {
                runId,
              },
            });
          },
        },
        ...(request.signal
          ? { signal: request.signal }
          : {}),
        onFailure: (
          failure,
        ) => {
          if (
            failure.fatal &&
            !failure.aborted
          ) {
            fail(
              new Error(
                failure.reason,
              ),
            );
          }
        },
        onTransportError: (
          reason,
        ) => {
          fail(new Error(reason));
        },
        onStaleTrial: (
          reason,
        ) => {
          fail(new Error(reason));
        },
        onReportError: fail,
      });

    const listener = (
      message: BackgroundMessage,
    ) => {
      if (
        message.type === 'RUN_PROGRESS' &&
        message.progress.run_id ===
          request.config.run_id
      ) {
        latestProgress =
          message.progress;
        request.onProgress?.(
          latestProgress,
        );

        if (
          isTerminal(
            latestProgress.status,
          )
        ) {
          finish(latestProgress);
        }
        return;
      }

      if (
        message.type === 'RUN_UPDATE' &&
        message.update.run_id ===
          request.config.run_id
      ) {
        latestProgress =
          mergeRunUpdate(
            latestProgress,
            message.update,
          );
        request.onProgress?.(
          latestProgress,
        );

        if (
          isTerminal(
            latestProgress.status,
          )
        ) {
          finish(latestProgress);
        }
        return;
      }

      if (
        message.type === 'NEXT_TRIAL' &&
        message.trial.run_id ===
          request.config.run_id
      ) {
        runner.enqueue(
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
      runner.dispose();
      unsubscribe();
      request.signal?.removeEventListener(
        'abort',
        abortListener,
      );

      try {
        await request.transport.request({
          type: 'DELETE_RUN',
          payload: {
            runId:
              request.config.run_id,
          },
        });
      } catch {
        try {
          await request.transport.request({
            type: 'CLEAR_RUN_OWNER',
            payload: {
              runId:
                request.config.run_id,
            },
          });
        } catch {
          // Temporary-study cleanup is best-effort after cancellation/failure.
        }
      }
    }
  };
