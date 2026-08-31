import type {
  RunProgress,
  RunUpdate,
  TrialSummary,
} from '../protocol/types';

const orderedTrials = (
  trials: TrialSummary[],
): TrialSummary[] => {
  for (
    let index = 1;
    index < trials.length;
    index += 1
  ) {
    if (
      trials[index - 1]!.trial_number >
      trials[index]!.trial_number
    ) {
      return [...trials].sort(
        (left, right) =>
          left.trial_number -
          right.trial_number,
      );
    }
  }

  return trials;
};

const progressFromUpdate = (
  update: RunUpdate,
  trials: TrialSummary[],
): RunProgress => ({
  run_id: update.run_id,
  status: update.status,
  completed_trials:
    update.completed_trials,
  target_trials:
    update.target_trials,
  failed_trials:
    update.failed_trials,
  reused_trials:
    update.reused_trials ?? 0,
  best: update.best,
  termination_reason:
    update.termination_reason ?? null,
  trials,
});

const canAppendUpdates = (
  existing: TrialSummary[],
  updates: TrialSummary[],
): boolean => {
  let previous =
    existing.at(-1)?.trial_number ?? -1;

  for (const trial of updates) {
    if (trial.trial_number <= previous) {
      return false;
    }
    previous = trial.trial_number;
  }

  return true;
};

export const mergeRunUpdate = (
  current: RunProgress | null,
  update: RunUpdate,
): RunProgress => {
  if (
    !current ||
    current.run_id !== update.run_id
  ) {
    return progressFromUpdate(
      update,
      orderedTrials(update.trial_updates),
    );
  }

  if (update.trial_updates.length === 0) {
    return progressFromUpdate(
      update,
      current.trials,
    );
  }

  // Normal trial updates are strictly append-only. Keep that hot path to one
  // array copy instead of rebuilding a Map and sorting the entire history on
  // every completed trial. The fallback still handles repeated/out-of-order
  // updates safely during recovery or duplicate delivery.
  if (
    canAppendUpdates(
      current.trials,
      update.trial_updates,
    )
  ) {
    return progressFromUpdate(
      update,
      current.trials.concat(
        update.trial_updates,
      ),
    );
  }

  const trials = new Map(
    current.trials.map(
      (trial) => [
        trial.trial_number,
        trial,
      ] as const,
    ),
  );

  for (const trial of update.trial_updates) {
    trials.set(
      trial.trial_number,
      trial,
    );
  }

  return progressFromUpdate(
    update,
    [...trials.values()].sort(
      (left, right) =>
        left.trial_number -
        right.trial_number,
    ),
  );
};
