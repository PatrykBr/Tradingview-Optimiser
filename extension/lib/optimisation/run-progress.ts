import type {
  RunProgress,
  RunUpdate,
} from '../protocol/types';

export const mergeRunUpdate = (
  current: RunProgress | null,
  update: RunUpdate,
): RunProgress => {
  const trials = new Map(
    current?.run_id === update.run_id
      ? current.trials.map(
          (trial) => [
            trial.trial_number,
            trial,
          ] as const,
        )
      : [],
  );

  for (const trial of update.trial_updates) {
    trials.set(
      trial.trial_number,
      trial,
    );
  }

  return {
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
    trials: [...trials.values()].sort(
      (left, right) =>
        left.trial_number -
        right.trial_number,
    ),
  };
};
