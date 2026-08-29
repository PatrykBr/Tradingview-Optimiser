import type {
  BacktestRange,
  CreateRun,
  RunProgress,
} from '../protocol/types';
import type {
  TradingViewMetrics,
} from '../tradingview/types';
import type {
  TradingViewBacktestRange,
} from '../tradingview/adapter';
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
  type RobustnessCandidateResult,
  type RobustnessFoldResult,
  type StabilityNeighbourResult,
  type StabilityParameterResult,
} from './research';

export interface ResearchBacktestAdapter {
  assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters:
      Record<string, unknown> | null,
  ): Promise<void>;

  evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
    signal?: AbortSignal,
  ): Promise<TradingViewMetrics>;

  prepareBacktest(
    strategyId: string,
    range: TradingViewBacktestRange | null,
  ): Promise<void>;

  applyParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

interface ResearchValidationRequest {
  adapter: ResearchBacktestAdapter;
  strategyId: string;
  config: CreateRun;
  progress: RunProgress;
  originalParameters:
    Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}

const deepRange = (
  startDate: string,
  endDate: string,
): BacktestRange => ({
  mode: 'deep',
  start_date: startDate,
  end_date: endDate,
});

const adapterRange = (
  range: BacktestRange | null,
): TradingViewBacktestRange | null =>
  range
    ? {
        startDate: range.start_date,
        endDate: range.end_date,
      }
    : null;

const objectiveValue = (
  metrics: Record<string, number>,
  metric: string,
): number | null => {
  const value = metrics[metric];

  return typeof value === 'number' &&
    Number.isFinite(value)
    ? value
    : null;
};

const assertValidationContext = async (
  request: ResearchValidationRequest,
  range: BacktestRange | null,
): Promise<void> => {
  await request.adapter.assertRunContext(
    request.strategyId,
    {
      ...request.config,
      backtest_range: range,
    },
    request.originalParameters,
  );
};

const evaluate = async (
  request: ResearchValidationRequest,
  parameters: Record<string, unknown>,
  range: BacktestRange | null,
): Promise<TradingViewMetrics> => {
  const metrics =
    await request.adapter.evaluateParameters(
      request.strategyId,
      parameters,
      adapterRange(range),
      request.signal,
    );

  await assertValidationContext(
    request,
    range,
  );

  return metrics;
};

const runRobustnessValidation = async (
  request: ResearchValidationRequest,
): Promise<
  NonNullable<ResearchEvaluation['robustness']>
> => {
  const settings =
    request.config.research?.robustness;

  if (!settings?.enabled) {
    throw new Error(
      'Robustness validation is not enabled for this run',
    );
  }

  const fullRange = settings.full_range;
  if (!fullRange) {
    throw new Error(
      'This experiment has no full range for robustness validation',
    );
  }

  const plan = splitResearchRange(
    fullRange,
    settings.validation_fraction,
    settings.folds,
  );
  const candidates = topFeasibleCandidates(
    request.progress.trials,
    request.config.direction,
    settings.top_candidates,
  );

  if (candidates.length === 0) {
    throw new Error(
      'No feasible completed trials are available for robustness validation',
    );
  }

  const candidateResults:
    RobustnessCandidateResult[] = [];

  for (
    const [
      candidateIndex,
      candidate,
    ] of candidates.entries()
  ) {
    const folds: RobustnessFoldResult[] = [];

    for (
      const [
        foldIndex,
        window,
      ] of plan.validationWindows.entries()
    ) {
      request.onPhase?.(
        'OOS candidate ' +
          (candidateIndex + 1) +
          '/' +
          candidates.length +
          ' · fold ' +
          (foldIndex + 1) +
          '/' +
          plan.validationWindows.length,
      );

      const range = deepRange(
        window.startDate,
        window.endDate,
      );
      const metrics = await evaluate(
        request,
        candidate.parameters,
        range,
      );
      const objective = objectiveValue(
        metrics,
        request.config.objective_metric,
      );

      folds.push({
        window,
        metrics,
        objectiveValue: objective,
        passedFilters:
          objective !== null &&
          passesMetricFilters(
            metrics,
            request.config.filters,
          ),
      });
    }

    if (
      candidate.objective_value === null
    ) {
      continue;
    }

    const validationObjective = median(
      folds
        .map(
          (fold) =>
            fold.objectiveValue,
        )
        .filter(
          (value): value is number =>
            value !== null,
        ),
    );

    candidateResults.push({
      trialNumber:
        candidate.trial_number,
      parameters:
        candidate.parameters,
      optimisationObjective:
        candidate.objective_value,
      validationObjective,
      passedWindows: folds.filter(
        (fold) => fold.passedFilters,
      ).length,
      totalWindows: folds.length,
      degradationPercent:
        validationObjective === null
          ? null
          : degradationPercent(
              candidate.objective_value,
              validationObjective,
              request.config.direction,
            ),
      folds,
    });
  }

  const ranked =
    rankRobustnessCandidates(
      candidateResults,
      request.config.direction,
    );
  const winner = ranked[0] ?? null;

  return {
    trainingRange: plan.trainingRange,
    validationWindows:
      plan.validationWindows,
    candidates: ranked,
    winnerTrialNumber:
      winner?.trialNumber ?? null,
    winnerParameters:
      winner?.parameters ?? null,
  };
};

const stabilityRange = (
  config: CreateRun,
  evaluation: ResearchEvaluation,
): BacktestRange | null => {
  const windows =
    evaluation.robustness
      ?.validationWindows;

  if (
    !windows ||
    windows.length === 0
  ) {
    return config.backtest_range ?? null;
  }

  const first = windows[0];
  const last =
    windows[windows.length - 1];

  if (!first || !last) {
    return config.backtest_range ?? null;
  }

  return deepRange(
    first.startDate,
    last.endDate,
  );
};

const runStabilityValidation = async (
  request: ResearchValidationRequest,
  evaluation: ResearchEvaluation,
  winnerParameters:
    Record<string, unknown>,
): Promise<
  NonNullable<ResearchEvaluation['stability']> | null
> => {
  const settings =
    request.config.research?.stability;

  if (!settings?.enabled) {
    return null;
  }

  const range = stabilityRange(
    request.config,
    evaluation,
  );
  const variants =
    buildStabilityVariants(
      request.config.parameters,
      winnerParameters,
      settings.perturbation_percent,
    );

  if (variants.length === 0) {
    return null;
  }

  request.onPhase?.(
    'Testing winner stability',
  );

  const baselineMetrics = await evaluate(
    request,
    winnerParameters,
    range,
  );
  const baselineObjective =
    objectiveValue(
      baselineMetrics,
      request.config.objective_metric,
    );

  if (baselineObjective === null) {
    throw new Error(
      'TradingView did not expose the objective metric for the stability baseline',
    );
  }

  const grouped = new Map<
    string,
    {
      baselineValue: number;
      neighbours:
        StabilityNeighbourResult[];
    }
  >();

  for (
    const [
      index,
      variant,
    ] of variants.entries()
  ) {
    request.onPhase?.(
      'Stability test ' +
        (index + 1) +
        '/' +
        variants.length,
    );

    const metrics = await evaluate(
      request,
      variant.parameters,
      range,
    );
    const objective = objectiveValue(
      metrics,
      request.config.objective_metric,
    );
    const passed =
      objective !== null &&
      passesMetricFilters(
        metrics,
        request.config.filters,
      );
    const degradation =
      objective === null
        ? null
        : degradationPercent(
            baselineObjective,
            objective,
            request.config.direction,
          );

    const current =
      grouped.get(
        variant.parameter,
      ) ?? {
        baselineValue:
          variant.baselineValue,
        neighbours: [],
      };

    current.neighbours.push({
      value: variant.value,
      objectiveValue: objective,
      degradationPercent:
        degradation,
      passedFilters: passed,
    });
    grouped.set(
      variant.parameter,
      current,
    );
  }

  const parameters:
    StabilityParameterResult[] =
    [...grouped.entries()].map(
      ([parameter, result]) => {
        const degradations =
          result.neighbours.map(
            (neighbour) =>
              neighbour.passedFilters &&
              neighbour
                .degradationPercent !==
                null
                ? Math.max(
                    0,
                    neighbour
                      .degradationPercent,
                  )
                : 100,
          );
        const average =
          degradations.reduce(
            (sum, value) =>
              sum + value,
            0,
          ) / degradations.length;

        return {
          parameter,
          baselineValue:
            result.baselineValue,
          rating:
            stabilityRating(average),
          averageDegradationPercent:
            average,
          neighbours:
            result.neighbours,
        };
      },
    );

  const worst = Math.max(
    ...parameters.map(
      (parameter) =>
        parameter
          .averageDegradationPercent,
    ),
  );

  return {
    baselineObjective,
    range,
    overallRating:
      stabilityRating(worst),
    parameters,
  };
};

export const runResearchValidation = async (
  request: ResearchValidationRequest,
): Promise<ResearchEvaluation> => {
  const settings =
    request.config.research;
  const best =
    request.progress.best;

  if (!best) {
    throw new Error(
      'Research validation requires a feasible best trial',
    );
  }

  if (
    !settings ||
    (!settings.robustness.enabled &&
      !settings.stability.enabled)
  ) {
    return {};
  }

  request.onPhase?.(
    'Preparing validation',
  );

  let primaryFailure: unknown;
  let winnerParameters =
    best.parameters;

  try {
    await request.adapter.assertRunContext(
      request.strategyId,
      request.config,
      request.originalParameters,
    );

    const evaluation:
      ResearchEvaluation = {};

    if (settings.robustness.enabled) {
      evaluation.robustness =
        await runRobustnessValidation(
          request,
        );

      if (
        evaluation.robustness
          .winnerParameters
      ) {
        winnerParameters =
          evaluation.robustness
            .winnerParameters;
      }
    }

    const stability =
      await runStabilityValidation(
        request,
        evaluation,
        winnerParameters,
      );

    if (stability) {
      evaluation.stability =
        stability;
    }

    return evaluation;
  } catch (cause) {
    primaryFailure = cause;
    throw cause;
  } finally {
    try {
      await request.adapter.prepareBacktest(
        request.strategyId,
        adapterRange(
          request.config
            .backtest_range ?? null,
        ),
      );
      await request.adapter.applyParameters(
        request.strategyId,
        winnerParameters,
      );
    } catch (restoreFailure) {
      if (primaryFailure === undefined) {
        throw restoreFailure;
      }
    }
  }
};
