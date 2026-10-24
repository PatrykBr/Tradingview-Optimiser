import type { ObjectiveDirection, TrialSummary } from '../protocol/types';

export type TrialFilter = 'all' | 'valid' | 'filtered' | 'failed';
export type TrialSort =
  'trial-desc' | 'trial-asc' | 'objective-best' | 'objective-worst' | 'duration';

export const isFeasibleTrial = (trial: TrialSummary): boolean =>
  trial.state === 'complete' && Object.values(trial.constraints).every((value) => value <= 0);

export const filterTrials = (trials: TrialSummary[], filter: TrialFilter): TrialSummary[] => {
  if (filter === 'all') return trials;

  return trials.filter((trial) => {
    if (filter === 'failed') return trial.state === 'failed';
    if (filter === 'valid') return isFeasibleTrial(trial);

    return trial.state === 'complete' && !isFeasibleTrial(trial);
  });
};

export const sortTrials = (
  trials: TrialSummary[],
  sort: TrialSort,
  direction: ObjectiveDirection,
): TrialSummary[] => {
  const objective = (trial: TrialSummary): number => {
    if (trial.objective_value === null) {
      return direction === 'maximize' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
    return trial.objective_value;
  };

  if (sort === 'trial-asc') {
    return [...trials];
  }

  if (sort === 'trial-desc') {
    return [...trials].reverse();
  }

  const copy = [...trials];

  switch (sort) {
    case 'duration':
      return copy.sort((a, b) => (b.duration_ms ?? -1) - (a.duration_ms ?? -1));
    case 'objective-worst':
      return copy.sort((a, b) =>
        direction === 'maximize' ? objective(a) - objective(b) : objective(b) - objective(a),
      );
    case 'objective-best':
      return copy.sort((a, b) =>
        direction === 'maximize' ? objective(b) - objective(a) : objective(a) - objective(b),
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

  let ordered = true;
  for (let index = 1; index < trials.length; index += 1) {
    if (trials[index - 1]!.trial_number > trials[index]!.trial_number) {
      ordered = false;
      break;
    }
  }

  const source = ordered ? trials : [...trials].sort((a, b) => a.trial_number - b.trial_number);

  for (const trial of source) {
    if (trial.objective_value === null || !isFeasibleTrial(trial)) {
      continue;
    }

    if (
      best === null ||
      (direction === 'maximize' ? trial.objective_value > best : trial.objective_value < best)
    ) {
      best = trial.objective_value;
    }

    points.push({
      trial: trial.trial_number,
      value: best,
    });
  }

  return points;
};

export const extendBestSoFar = (
  existing: BestSoFarPoint[],
  newTrials: TrialSummary[],
  direction: ObjectiveDirection,
): BestSoFarPoint[] => {
  if (newTrials.length === 0) {
    return existing;
  }

  let best = existing.at(-1)?.value ?? null;
  const points = [...existing];

  for (const trial of newTrials) {
    if (trial.objective_value === null || !isFeasibleTrial(trial)) {
      continue;
    }

    if (
      best === null ||
      (direction === 'maximize' ? trial.objective_value > best : trial.objective_value < best)
    ) {
      best = trial.objective_value;
    }

    points.push({
      trial: trial.trial_number,
      value: best,
    });
  }

  return points;
};

export const estimateRemainingMs = (
  trials: TrialSummary[],
  completed: number,
  target: number,
): number | null => {
  if (completed >= target) {
    return null;
  }

  const recent: number[] = [];

  for (let index = trials.length - 1; index >= 0 && recent.length < 20; index -= 1) {
    const duration = trials[index]?.duration_ms;

    if (typeof duration === 'number' && duration >= 0) {
      recent.push(duration);
    }
  }

  if (recent.length === 0) {
    return null;
  }

  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;

  return average * Math.max(0, target - completed);
};
