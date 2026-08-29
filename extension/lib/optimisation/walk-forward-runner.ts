import type {
  CreateRun,
  RunProgress,
} from '../protocol/types';
import type {
  TradingViewAdapter,
} from '../tradingview/adapter';
import {
  passesMetricFilters,
} from './research';
import {
  buildWalkForwardPlan,
  summariseWalkForward,
  type WalkForwardFoldResult,
  type WalkForwardResult,
} from './walk-forward';

export interface WalkForwardStudyRunner {
  (
    config: CreateRun,
    strategyId: string,
    originalParameters:
      Record<string, unknown> | null,
    signal?: AbortSignal,
    onPhase?: (update: {
      number: number;
      parameters:
        Record<string, unknown>;
      phase:
        | 'checking'
        | 'recalculating'
        | 'submitting';
    }) => void,
    onProgress?: (
      progress: RunProgress,
    ) => void,
  ): Promise<RunProgress>;
}

export interface WalkForwardExecutionRequest {
  adapter: TradingViewAdapter;
  runStudy: WalkForwardStudyRunner;
  strategyId: string;
  config: CreateRun;
  parentProgress: RunProgress;
  originalParameters:
    Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}

const disabledResearch =
  (): NonNullable<CreateRun['research']> => ({
  convergence: {
    enabled: false,
    min_trials: 50,
    patience: 30,
    min_improvement_percent: 1,
  },
  robustness: {
    enabled: false,
    full_range: null,
    validation_fraction: 0.3,
    folds: 3,
    top_candidates: 5,
  },
  stability: {
    enabled: false,
    perturbation_percent: 5,
  },
  walk_forward: {
    enabled: false,
    full_range: null,
    folds: 3,
    trials_per_fold: 100,
    initial_training_fraction: 0.5,
  },
  monte_carlo: {
    enabled: false,
    simulations: 5_000,
    confidence: 0.9,
  },
});

const childConfig = (
  parent: CreateRun,
  runId: string,
  trainingRange:
    NonNullable<CreateRun['backtest_range']>,
  trials: number,
): CreateRun => ({
  ...parent,
  run_id: runId,
  target_trials: trials,
  backtest_range: trainingRange,
  research:
    disabledResearch(),
});

const testConfig = (
  parent: CreateRun,
  testRange:
    NonNullable<CreateRun['backtest_range']>,
): CreateRun => ({
  ...parent,
  backtest_range: testRange,
  research:
    disabledResearch(),
});

export const runWalkForwardValidation =
  async (
    request: WalkForwardExecutionRequest,
  ): Promise<WalkForwardResult> => {
    const settings =
      request.config.research
        ?.walk_forward;
    const fullRange =
      settings?.full_range;

    if (
      !settings?.enabled ||
      !fullRange
    ) {
      throw new Error(
        'Walk-forward validation is not configured for this run',
      );
    }

    const plan = buildWalkForwardPlan(
      fullRange,
      settings.folds,
      settings.initial_training_fraction,
    );
    const results:
      WalkForwardFoldResult[] = [];

    const restoreParameters =
      request.parentProgress.best
        ?.parameters ??
      request.config
        .baseline_parameters ??
      {};

    let primaryFailure: unknown;

    try {
      for (
        const [
          foldIndex,
          fold,
        ] of plan.entries()
      ) {
        if (request.signal?.aborted) {
          throw new DOMException(
            'Operation aborted',
            'AbortError',
          );
        }

        request.onPhase?.(
          'Walk-forward fold ' +
            (foldIndex + 1) +
            '/' +
            plan.length +
            ' · optimising',
        );

        const config = childConfig(
          request.config,
          'wf-' +
            crypto.randomUUID(),
          fold.trainingRange,
          settings.trials_per_fold,
        );

        await request.adapter.prepareBacktest(
          request.strategyId,
          {
            startDate:
              fold.trainingRange.start_date,
            endDate:
              fold.trainingRange.end_date,
          },
        );

        const progress =
          await request.runStudy(
            config,
            request.strategyId,
            request.originalParameters,
            request.signal,
            (update) =>
              request.onPhase?.(
                'Walk-forward fold ' +
                  (foldIndex + 1) +
                  '/' +
                  plan.length +
                  ' · trial ' +
                  update.number +
                  ' · ' +
                  update.phase,
              ),
          );

        const best = progress.best;

        if (!best) {
          results.push({
            fold,
            runId: config.run_id,
            completedTrials:
              progress.completed_trials,
            bestParameters: null,
            inSampleObjective: null,
            testObjective: null,
            passedFilters: false,
          });
          continue;
        }

        request.onPhase?.(
          'Walk-forward fold ' +
            (foldIndex + 1) +
            '/' +
            plan.length +
            ' · unseen test',
        );

        const metrics =
          await request.adapter.evaluateParameters(
            request.strategyId,
            best.parameters,
            {
              startDate:
                fold.testRange.start_date,
              endDate:
                fold.testRange.end_date,
            },
            request.signal,
          );

        await request.adapter.assertRunContext(
          request.strategyId,
          testConfig(
            request.config,
            fold.testRange,
          ),
          request.originalParameters,
        );

        const objective =
          metrics[
            request.config
              .objective_metric
          ];

        results.push({
          fold,
          runId: config.run_id,
          completedTrials:
            progress.completed_trials,
          bestParameters:
            best.parameters,
          inSampleObjective:
            best.objective_value,
          testObjective:
            typeof objective ===
                'number' &&
              Number.isFinite(objective)
              ? objective
              : null,
          passedFilters:
            passesMetricFilters(
              metrics,
              request.config.filters,
            ),
        });
      }

      return summariseWalkForward(
        results,
        request.config.parameters,
        request.config.direction,
      );
    } catch (cause) {
      primaryFailure = cause;
      throw cause;
    } finally {
      try {
        await request.adapter.prepareBacktest(
          request.strategyId,
          request.config.backtest_range
            ? {
                startDate:
                  request.config
                    .backtest_range
                    .start_date,
                endDate:
                  request.config
                    .backtest_range
                    .end_date,
              }
            : null,
        );

        if (
          Object.keys(
            restoreParameters,
          ).length > 0
        ) {
          await request.adapter.applyParameters(
            request.strategyId,
            restoreParameters,
          );
        }
      } catch (restoreFailure) {
        if (primaryFailure === undefined) {
          throw restoreFailure;
        }
      }
    }
  };
