import type {
  BacktestRange,
  MetricFilter,
  ObjectiveDirection,
  SearchParameter,
  TrialSummary,
} from '../protocol/types';
import type { MonteCarloResult } from './monte-carlo';
import { DAY_MS, formatDate, parseDate } from './dates';
import { isFeasibleTrial } from './results';
import type { WalkForwardResult } from './walk-forward';

export interface ValidationWindow {
  index: number;
  startDate: string;
  endDate: string;
}

export interface RobustnessFoldResult {
  window: ValidationWindow;
  metrics: Record<string, number>;
  objectiveValue: number | null;
  passedFilters: boolean;
}

export interface RobustnessCandidateResult {
  trialNumber: number;
  parameters: Record<string, unknown>;
  optimisationObjective: number;
  validationObjective: number | null;
  passedWindows: number;
  totalWindows: number;
  degradationPercent: number | null;
  folds: RobustnessFoldResult[];
}

export interface RobustnessResult {
  trainingRange: BacktestRange;
  validationWindows: ValidationWindow[];
  candidates: RobustnessCandidateResult[];
  winnerTrialNumber: number | null;
  winnerParameters: Record<string, unknown> | null;
}

export type StabilityRating = 'strong' | 'moderate' | 'fragile';

export interface StabilityNeighbourResult {
  value: number | boolean | string;
  objectiveValue: number | null;
  degradationPercent: number | null;
  passedFilters: boolean;
}

export interface StabilityParameterResult {
  parameter: string;
  baselineValue: number;
  rating: StabilityRating;
  averageDegradationPercent: number;
  neighbours: StabilityNeighbourResult[];
}

export interface StabilityResult {
  baselineObjective: number;
  range: BacktestRange | null;
  overallRating: StabilityRating;
  parameters: StabilityParameterResult[];
}

export interface ResearchEvaluation {
  robustness?: RobustnessResult;
  stability?: StabilityResult;
  walkForward?: WalkForwardResult;
  monteCarlo?: MonteCarloResult;
}

export const splitResearchRange = (
  fullRange: BacktestRange,
  validationFraction: number,
  folds: number,
): {
  trainingRange: BacktestRange;
  validationWindows: ValidationWindow[];
} => {
  const start = parseDate(fullRange.start_date);
  const end = parseDate(fullRange.end_date);
  const totalDays = Math.floor((end - start) / DAY_MS);

  if (totalDays < folds + 10) {
    throw new Error(
      'Deep Backtesting range is too short for the selected robustness folds',
    );
  }

  const validationDays = Math.max(
    folds,
    Math.round(totalDays * validationFraction),
  );
  const trainingDays = totalDays - validationDays;

  if (validationDays < folds * 2) {
    throw new Error('Each robustness fold needs at least two days; use fewer folds or a longer range');
  }

  if (trainingDays < 5) {
    throw new Error(
      'Robustness validation leaves too little optimisation data',
    );
  }

  const trainingEnd = start + trainingDays * DAY_MS;
  const validationStart = trainingEnd + DAY_MS;
  const validationEnd = end;
  const windows: ValidationWindow[] = [];
  let cursor = validationStart;

  for (let index = 0; index < folds; index += 1) {
    const remainingWindows = folds - index;
    const remainingDays =
      Math.floor((validationEnd - cursor) / DAY_MS) + 1;
    const windowDays = Math.max(
      1,
      Math.floor(remainingDays / remainingWindows),
    );
    const windowEnd =
      index === folds - 1
        ? validationEnd
        : cursor + (windowDays - 1) * DAY_MS;

    windows.push({
      index,
      startDate: formatDate(cursor),
      endDate: formatDate(windowEnd),
    });
    cursor = windowEnd + DAY_MS;
  }

  return {
    trainingRange: {
      mode: 'deep',
      start_date: fullRange.start_date,
      end_date: formatDate(trainingEnd),
    },
    validationWindows: windows,
  };
};

export const passesMetricFilters = (
  metrics: Record<string, number>,
  filters: MetricFilter[],
): boolean =>
  filters.every((filter) => {
    const actual = metrics[filter.metric];
    if (
      typeof actual !== 'number' ||
      !Number.isFinite(actual)
    ) {
      return false;
    }

    return filter.operator === 'lte'
      ? actual <= filter.value
      : actual >= filter.value;
  });

export const topFeasibleCandidates = (
  trials: TrialSummary[],
  direction: ObjectiveDirection,
  count: number,
): TrialSummary[] => {
  const seen = new Set<string>();
  return trials
    .filter(
      (trial) =>
        isFeasibleTrial(trial) &&
        trial.objective_value !== null,
    )
    .sort((left, right) => {
      const a = left.objective_value;
      const b = right.objective_value;

      if (a === null) return 1;
      if (b === null) return -1;

      return direction === 'maximize'
        ? b - a
        : a - b;
    })
    .filter((trial) => {
      const key = JSON.stringify(
        Object.entries(trial.parameters).sort(([a], [b]) => a.localeCompare(b)),
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
};

export const median = (
  values: number[],
): number | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort(
    (a, b) => a - b,
  );
  const middle = Math.floor(
    sorted.length / 2,
  );
  const right = sorted[middle];

  if (right === undefined) {
    return null;
  }

  if (sorted.length % 2 !== 0) {
    return right;
  }

  const left = sorted[middle - 1];
  return left === undefined
    ? null
    : (left + right) / 2;
};

export const degradationPercent = (
  baseline: number,
  candidate: number,
  direction: ObjectiveDirection,
): number => {
  const scale = Math.max(Math.abs(baseline), 1e-9);
  const degradation =
    direction === 'maximize'
      ? baseline - candidate
      : candidate - baseline;

  return (degradation / scale) * 100;
};

export const rankRobustnessCandidates = (
  candidates: RobustnessCandidateResult[],
  direction: ObjectiveDirection,
): RobustnessCandidateResult[] =>
  [...candidates].sort((left, right) => {
    if (left.passedWindows !== right.passedWindows) {
      return right.passedWindows - left.passedWindows;
    }

    const leftScore = left.validationObjective;
    const rightScore = right.validationObjective;

    if (leftScore === null) return 1;
    if (rightScore === null) return -1;

    return direction === 'maximize'
      ? rightScore - leftScore
      : leftScore - rightScore;
  });

export interface StabilityVariant {
  parameter: string;
  baselineValue: number;
  value: number;
  parameters: Record<string, unknown>;
}

const clamp = (
  value: number,
  low: number,
  high: number,
): number => Math.min(high, Math.max(low, value));

export const buildStabilityVariants = (
  searchSpace: SearchParameter[],
  winner: Record<string, unknown>,
  perturbationPercent: number,
): StabilityVariant[] => {
  const variants: StabilityVariant[] = [];

  for (const parameter of searchSpace) {
    if (parameter.type === 'categorical') continue;

    const raw = winner[parameter.name];
    if (typeof raw !== 'number') continue;

    const range = parameter.high - parameter.low;
    const minimumDelta =
      parameter.type === 'int'
        ? parameter.step ?? 1
        : parameter.step ?? 0;
    const delta = Math.max(
      range * (perturbationPercent / 100),
      minimumDelta,
      Number.EPSILON,
    );

    const values = [raw - delta, raw + delta]
      .map((candidate) => {
        const clamped = clamp(
          candidate,
          parameter.low,
          parameter.high,
        );

        const step = parameter.step ?? (parameter.type === 'int' ? 1 : undefined);
        if (step !== undefined) {
          // Clamp the grid index: rounding the value can overshoot an unaligned high bound.
          const width = (parameter.high - parameter.low) / step;
          const maxIndex = Math.floor(
            parameter.type === 'int' ? width : Number(width.toPrecision(12)),
          );
          const index = clamp(Math.round((clamped - parameter.low) / step), 0, maxIndex);
          const aligned = parameter.low + index * step;
          return parameter.type === 'int' ? aligned : Number(aligned.toPrecision(12));
        }

        return Number(clamped.toPrecision(12));
      })
      .filter(
        (value, index, all) =>
          value !== raw &&
          all.indexOf(value) === index,
      );

    for (const value of values) {
      variants.push({
        parameter: parameter.name,
        baselineValue: raw,
        value,
        parameters: {
          ...winner,
          [parameter.name]: value,
        },
      });
    }
  }

  return variants;
};

export const stabilityRating = (
  degradation: number,
): StabilityRating => {
  if (degradation <= 5) return 'strong';
  if (degradation <= 15) return 'moderate';
  return 'fragile';
};
