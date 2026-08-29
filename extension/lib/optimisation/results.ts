import type {
  ObjectiveDirection,
  TrialSummary,
} from '../protocol/types';

export type TrialFilter = 'all' | 'valid' | 'filtered' | 'failed';
export type TrialSort =
  | 'trial-desc'
  | 'trial-asc'
  | 'objective-best'
  | 'objective-worst'
  | 'duration';

export const isFeasibleTrial = (trial: TrialSummary): boolean =>
  trial.state === 'complete' &&
  Object.values(trial.constraints).every((value) => value <= 0);

export const filterTrials = (
  trials: TrialSummary[],
  filter: TrialFilter,
): TrialSummary[] => {
  if (filter === 'all') return trials;

  return trials.filter((trial) => {
    if (filter === 'failed') return trial.state === 'failed';
    if (filter === 'valid') return isFeasibleTrial(trial);

    return (
      trial.state === 'complete' &&
      !isFeasibleTrial(trial)
    );
  });
};

export const sortTrials = (
  trials: TrialSummary[],
  sort: TrialSort,
  direction: ObjectiveDirection,
): TrialSummary[] => {
  const copy = [...trials];

  const objective = (trial: TrialSummary): number => {
    if (trial.objective_value === null) {
      return direction === 'maximize'
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY;
    }
    return trial.objective_value;
  };

  switch (sort) {
    case 'trial-asc':
      return copy.sort((a, b) => a.trial_number - b.trial_number);
    case 'trial-desc':
      return copy.sort((a, b) => b.trial_number - a.trial_number);
    case 'duration':
      return copy.sort(
        (a, b) =>
          (b.duration_ms ?? -1) - (a.duration_ms ?? -1),
      );
    case 'objective-worst':
      return copy.sort((a, b) =>
        direction === 'maximize'
          ? objective(a) - objective(b)
          : objective(b) - objective(a),
      );
    case 'objective-best':
      return copy.sort((a, b) =>
        direction === 'maximize'
          ? objective(b) - objective(a)
          : objective(a) - objective(b),
      );
  }
};

export interface BestSoFarPoint {
  trial: number;
  value: number;
}

export const bestSoFar = (
  trials: TrialSummary[],
  direction: ObjectiveDirection,
): BestSoFarPoint[] => {
  let best: number | null = null;
  const points: BestSoFarPoint[] = [];

  for (const trial of [...trials].sort(
    (a, b) => a.trial_number - b.trial_number,
  )) {
    if (
      trial.objective_value === null ||
      !isFeasibleTrial(trial)
    ) {
      continue;
    }

    if (
      best === null ||
      (direction === 'maximize'
        ? trial.objective_value > best
        : trial.objective_value < best)
    ) {
      best = trial.objective_value;
    }

    points.push({ trial: trial.trial_number, value: best });
  }

  return points;
};

export const estimateRemainingMs = (
  trials: TrialSummary[],
  completed: number,
  target: number,
): number | null => {
  const durations = trials
    .map((trial) => trial.duration_ms)
    .filter(
      (duration): duration is number =>
        typeof duration === 'number' && duration >= 0,
    );

  if (durations.length === 0 || completed >= target) return null;

  const recent = durations.slice(-20);
  const average =
    recent.reduce((sum, value) => sum + value, 0) /
    recent.length;

  return average * Math.max(0, target - completed);
};
