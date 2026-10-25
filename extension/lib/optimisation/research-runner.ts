import { forEachSequential, withCleanup } from '../async';
import type { BacktestRange, CreateRun, RunProgress } from '../protocol/types';
import type { TradingViewAdapter } from '../tradingview/adapter';
import { runTradeMonteCarlo } from './monte-carlo';
import {
  buildStabilityVariants,
  degradationPercent,
  median,
  passesMetricFilters,
  rankRobustnessCandidates,
  splitResearchRange,
  stabilityRating,
  topFeasibleCandidates,
  type ResearchEvaluation,
  type RobustnessFoldResult,
  type StabilityNeighbourResult,
} from './research';
import {
  buildWalkForwardPlan,
  summariseWalkForward,
  type WalkForwardFoldResult,
} from './walk-forward';
import type { TrialExecutionUpdate } from './study-trial-runner';

export type ResearchBacktestAdapter = Pick<
  TradingViewAdapter,
  | 'assertRunContext'
  | 'evaluateParameters'
  | 'prepareBacktest'
  | 'applyParameters'
  | 'readClosedTrades'
>;

interface ResearchValidationRequest {
  adapter: ResearchBacktestAdapter;
  strategyId: string;
  config: CreateRun;
  progress: RunProgress;
  originalParameters: Record<string, unknown> | null;
  runStudy?: (
    config: CreateRun,
    strategyId: string,
    originalParameters: Record<string, unknown> | null,
    signal?: AbortSignal,
    onPhase?: (update: TrialExecutionUpdate) => void,
  ) => Promise<RunProgress>;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}

const validationRange = (evaluation: ResearchEvaluation): BacktestRange | null => {
  const first = evaluation.robustness?.validationWindows[0];
  const last = evaluation.robustness?.validationWindows.at(-1);
  return first && last
    ? { mode: 'deep', start_date: first.startDate, end_date: last.endDate }
    : null;
};

export async function runResearchValidation(
  request: ResearchValidationRequest,
): Promise<ResearchEvaluation> {
  const { adapter, config, progress, strategyId, originalParameters, signal, onPhase } = request;
  const settings = config.research;
  const best = progress.best;
  if (!best) throw new Error('Research validation requires a feasible best trial');
  if (
    !settings ||
    ![settings.robustness, settings.stability, settings.walk_forward, settings.monte_carlo].some(
      (stage) => stage?.enabled,
    )
  )
    return {};

  const evaluation: ResearchEvaluation = {};
  let restoreParameters = best.parameters;
  const objective = (metrics: Record<string, number>): number | null => {
    const value = metrics[config.objective_metric];
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
  const assertContext = (range: BacktestRange | null | undefined) =>
    adapter.assertRunContext(
      strategyId,
      { ...config, backtest_range: range ?? null },
      originalParameters,
    );
  const evaluate = async (parameters: Record<string, unknown>, range: BacktestRange | null) => {
    signal?.throwIfAborted();
    const metrics = await adapter.evaluateParameters(strategyId, parameters, range, signal);
    signal?.throwIfAborted();
    await assertContext(range);
    signal?.throwIfAborted();
    return metrics;
  };

  const validateRobustness = async () => {
    if (!settings.robustness.enabled) return;
    const fullRange = settings.robustness.full_range;
    if (!fullRange) throw new Error('This experiment has no full range for robustness validation');
    const plan = splitResearchRange(
      fullRange,
      settings.robustness.validation_fraction,
      settings.robustness.folds,
    );
    const candidates = topFeasibleCandidates(
      progress.trials,
      config.direction,
      settings.robustness.top_candidates,
    ).map((trial) => ({ trial, folds: [] as RobustnessFoldResult[] }));
    if (!candidates.length)
      throw new Error('No feasible completed trials are available for robustness validation');

    // Keep dates fixed while evaluating every candidate in a window.
    await forEachSequential(plan.validationWindows, async (window) => {
      const range: BacktestRange = {
        mode: 'deep',
        start_date: window.startDate,
        end_date: window.endDate,
      };
      await forEachSequential(candidates, async (candidate, index) => {
        onPhase?.(
          `OOS fold ${window.index + 1}/${plan.validationWindows.length} · candidate ${index + 1}/${candidates.length}`,
        );
        const metrics = await evaluate(candidate.trial.parameters, range);
        const value = objective(metrics);
        candidate.folds.push({
          window,
          metrics,
          objectiveValue: value,
          passedFilters: value !== null && passesMetricFilters(metrics, config.filters),
        });
      });
    });
    const ranked = rankRobustnessCandidates(
      candidates.map(({ trial, folds }) => {
        const validationObjective = median(
          folds.flatMap((fold) => (fold.objectiveValue === null ? [] : [fold.objectiveValue])),
        );
        return {
          trialNumber: trial.trial_number,
          parameters: trial.parameters,
          optimisationObjective: trial.objective_value!,
          validationObjective,
          passedWindows: folds.filter((fold) => fold.passedFilters).length,
          totalWindows: folds.length,
          degradationPercent:
            validationObjective === null
              ? null
              : degradationPercent(trial.objective_value!, validationObjective, config.direction),
          folds,
        };
      }),
      config.direction,
    );
    const winner = ranked[0];
    evaluation.robustness = {
      ...plan,
      candidates: ranked,
      winnerTrialNumber: winner?.trialNumber ?? null,
      winnerParameters: winner?.parameters ?? null,
    };
    restoreParameters = winner?.parameters ?? best.parameters;
  };

  const validateStability = async () => {
    if (!settings.stability.enabled) return;
    const range = validationRange(evaluation) ?? config.backtest_range ?? null;
    const variants = buildStabilityVariants(
      config.parameters,
      restoreParameters,
      settings.stability.perturbation_percent,
    );
    if (variants.length) {
      onPhase?.('Testing winner stability');
      const baselineObjective = objective(await evaluate(restoreParameters, range));
      if (baselineObjective === null)
        throw new Error(
          'TradingView did not expose the objective metric for the stability baseline',
        );
      const grouped = new Map<
        string,
        { baselineValue: number; neighbours: StabilityNeighbourResult[] }
      >();
      await forEachSequential(variants, async (variant, index) => {
        onPhase?.(`Stability test ${index + 1}/${variants.length}`);
        const metrics = await evaluate(variant.parameters, range);
        const value = objective(metrics);
        const result = grouped.get(variant.parameter) ?? {
          baselineValue: variant.baselineValue,
          neighbours: [],
        };
        result.neighbours.push({
          value: variant.value,
          objectiveValue: value,
          passedFilters: value !== null && passesMetricFilters(metrics, config.filters),
          degradationPercent:
            value === null ? null : degradationPercent(baselineObjective, value, config.direction),
        });
        grouped.set(variant.parameter, result);
      });
      const parameters = [...grouped].map(([parameter, result]) => {
        const average =
          result.neighbours.reduce(
            (sum, neighbour) =>
              sum +
              (neighbour.passedFilters && neighbour.degradationPercent !== null
                ? Math.max(0, neighbour.degradationPercent)
                : 100),
            0,
          ) / result.neighbours.length;
        return {
          parameter,
          ...result,
          rating: stabilityRating(average),
          averageDegradationPercent: average,
        };
      });
      evaluation.stability = {
        baselineObjective,
        range,
        parameters,
        overallRating: stabilityRating(
          Math.max(...parameters.map((parameter) => parameter.averageDegradationPercent)),
        ),
      };
    }
  };

  const validateWalkForward = async () => {
    if (!settings.walk_forward?.enabled) return;
    const walkForward = settings.walk_forward;
    const runStudy = request.runStudy;
    if (!walkForward.full_range || !runStudy)
      throw new Error('Walk-forward validation requires a full range and a study runner');
    restoreParameters = best.parameters;
    const plan = buildWalkForwardPlan(
      walkForward.full_range,
      walkForward.folds,
      walkForward.initial_training_fraction,
    );
    const folds: WalkForwardFoldResult[] = [];
    await forEachSequential(plan, async (fold) => {
      signal?.throwIfAborted();
      const phase = `Walk-forward fold ${fold.index + 1}/${plan.length}`;
      onPhase?.(`${phase} · optimising`);
      const child = {
        ...config,
        run_id: `wf-${crypto.randomUUID()}`,
        target_trials: walkForward.trials_per_fold,
        backtest_range: fold.trainingRange,
      };
      // Omit parent research settings; the backend supplies disabled defaults.
      delete child.research;
      await adapter.prepareBacktest(strategyId, fold.trainingRange);
      const childProgress = await runStudy(
        child,
        strategyId,
        originalParameters,
        signal,
        (update) => onPhase?.(`${phase} · trial ${update.number} · ${update.phase}`),
      );
      signal?.throwIfAborted();
      const winner = childProgress.best;
      let testObjective: number | null = null;
      let passedFilters = false;
      if (winner) {
        onPhase?.(`${phase} · unseen test`);
        const metrics = await evaluate(winner.parameters, fold.testRange);
        testObjective = objective(metrics);
        passedFilters = testObjective !== null && passesMetricFilters(metrics, config.filters);
      }
      folds.push({
        fold,
        runId: child.run_id,
        completedTrials: childProgress.completed_trials,
        bestParameters: winner?.parameters ?? null,
        inSampleObjective: winner?.objective_value ?? null,
        testObjective,
        passedFilters,
      });
    });
    evaluation.walkForward = summariseWalkForward(folds, config.parameters, config.direction);
  };

  const validateMonteCarlo = async () => {
    if (!settings.monte_carlo?.enabled) return;
    const lastFold = evaluation.walkForward?.folds.at(-1);
    const unseenRange = validationRange(evaluation) ?? lastFold?.fold.testRange;
    const range = unseenRange ?? config.backtest_range ?? null;
    restoreParameters =
      evaluation.robustness?.winnerParameters ?? lastFold?.bestParameters ?? best.parameters;
    onPhase?.('Preparing Monte Carlo trade sample');
    await evaluate(restoreParameters, range);
    const snapshot = await adapter.readClosedTrades(strategyId);
    onPhase?.(
      snapshot.available ? 'Running Monte Carlo simulations' : 'Trade-level data unavailable',
    );
    evaluation.monteCarlo = await runTradeMonteCarlo(
      snapshot,
      settings.monte_carlo.simulations,
      settings.monte_carlo.confidence,
      { source: unseenRange ? 'oos' : 'optimisation', range },
      signal,
    );
  };

  return withCleanup(
    async () => {
      signal?.throwIfAborted();
      onPhase?.('Preparing validation');
      await assertContext(config.backtest_range);

      await validateRobustness();

      await validateStability();

      await validateWalkForward();

      await validateMonteCarlo();
      return evaluation;
    },
    async () => {
      await adapter.prepareBacktest(strategyId, config.backtest_range ?? null);
      await adapter.applyParameters(strategyId, restoreParameters);
    },
    'Research validation failed and TradingView state could not be restored',
  );
}
