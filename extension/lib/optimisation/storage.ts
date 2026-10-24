import type {
  BestTrial,
  CreateRun,
  RunAnalysis,
  RunProgress,
  RunStatus,
} from '../protocol/types';
import type { ResearchEvaluation } from './research';

interface RunEnvironment {
  extensionVersion: string;
  backendVersion?: string;
  optunaVersion?: string;
}

export type PersistedRunIntent =
  | 'running'
  | 'stopped';

export type PersistedRunPhase =
  | 'starting'
  | 'running'
  | 'stopping';

export interface PersistedOptimisationRun {
  version: 2;
  config: CreateRun;
  strategyId: string;
  originalParameters: Record<string, unknown>;
  startedAt: number;
  intent: PersistedRunIntent;
  phase: PersistedRunPhase;
  environment?: RunEnvironment;
  finishedAt?: number;
  lastProgress?: RunProgress;
}

export interface ExperimentRecord {
  version: 1;
  runId: string;
  config: CreateRun;
  startedAt: number;
  finishedAt: number;
  status: RunStatus;
  completedTrials: number;
  failedTrials: number;
  reusedTrials?: number;
  terminationReason:
    | 'target_trials'
    | 'converged'
    | 'search_space_exhausted'
    | 'user'
    | null;
  best: BestTrial | null;
  environment?: RunEnvironment;
  analysis?: RunAnalysis;
  research?: ResearchEvaluation;
}

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value);

const parsePersistedRun = (
  value: unknown,
  label: string,
): PersistedOptimisationRun => {
  if (!isRecord(value)) {
    throw new Error(
      label + ' is corrupted',
    );
  }

  const config = value.config;
  const originalParameters =
    value.originalParameters;

  if (
    !isRecord(config) ||
    typeof config.run_id !== 'string' ||
    typeof value.strategyId !== 'string' ||
    !isRecord(originalParameters) ||
    typeof value.startedAt !== 'number' ||
    !Number.isFinite(value.startedAt)
  ) {
    throw new Error(
      label + ' is corrupted or incompatible',
    );
  }

  const base = {
    config: config as unknown as CreateRun,
    strategyId: value.strategyId,
    originalParameters,
    startedAt: value.startedAt,
    ...(isRecord(value.environment)
      ? {
          environment:
            value.environment as unknown as RunEnvironment,
        }
      : {}),
    ...(typeof value.finishedAt === 'number' &&
    Number.isFinite(value.finishedAt)
      ? { finishedAt: value.finishedAt }
      : {}),
    ...(isRecord(value.lastProgress)
      ? {
          lastProgress:
            value.lastProgress as unknown as RunProgress,
        }
      : {}),
  };

  if (value.version === 1) {
    return {
      version: 2,
      ...base,
      intent: 'running',
      phase: 'running',
    };
  }

  if (
    value.version !== 2 ||
    (value.intent !== 'running' &&
      value.intent !== 'stopped') ||
    (value.phase !== 'starting' &&
      value.phase !== 'running' &&
      value.phase !== 'stopping')
  ) {
    throw new Error(
      label + ' has an unsupported version or lifecycle state',
    );
  }

  return {
    version: 2,
    ...base,
    intent: value.intent,
    phase: value.phase,
  };
};

const RUN_STATUSES = new Set<RunStatus>([
  'created',
  'running',
  'stop_requested',
  'stopped',
  'completed',
  'failed',
]);

const isExperimentRecord = (
  value: unknown,
): value is ExperimentRecord => {
  if (!isRecord(value)) return false;

  return (
    value.version === 1 &&
    typeof value.runId === 'string' &&
    isRecord(value.config) &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    typeof value.finishedAt === 'number' &&
    Number.isFinite(value.finishedAt) &&
    typeof value.status === 'string' &&
    RUN_STATUSES.has(
      value.status as RunStatus,
    ) &&
    typeof value.completedTrials === 'number' &&
    typeof value.failedTrials === 'number' &&
    (value.best === null ||
      isRecord(value.best))
  );
};

const ACTIVE_RUN_KEY = 'activeOptimisationRun';
const LAST_RUN_KEY = 'lastOptimisationRun';
const EXPERIMENTS_KEY = 'optimisationExperimentsV1';
const MAX_EXPERIMENTS = 50;
const CHECKPOINT_INTERVAL_MS = 5_000;
const CHECKPOINT_TRIAL_INTERVAL = 10;

interface ActiveProgressCheckpoint {
  runId: string | null;
  settledTrials: number;
  savedAt: number;
}

let activeProgressCheckpoint: ActiveProgressCheckpoint = {
  runId: null,
  settledTrials: 0,
  savedAt: 0,
};

const resetActiveProgressCheckpoint = (): void => {
  activeProgressCheckpoint = {
    runId: null,
    settledTrials: 0,
    savedAt: 0,
  };
};

const lightweightProgress = (
  progress: RunProgress,
): RunProgress => ({
  ...progress,
  // Optuna stores trial history in SQLite. Save only a recovery checkpoint in
  // browser storage during the run. Write the full history when the run finishes.
  trials: [],
});

export const saveActiveRun = async (
  run: PersistedOptimisationRun,
): Promise<void> => {
  await browser.storage.local.set({
    [ACTIVE_RUN_KEY]: run,
  });

  if (
    activeProgressCheckpoint.runId !==
    run.config.run_id
  ) {
    activeProgressCheckpoint = {
      runId: run.config.run_id,
      settledTrials:
        (run.lastProgress?.completed_trials ?? 0) +
        (run.lastProgress?.failed_trials ?? 0),
      savedAt: Date.now(),
    };
  }
};

export const updateActiveRunProgress = async (
  progress: RunProgress,
): Promise<void> => {
  const now = Date.now();
  const settledTrials =
    progress.completed_trials +
    progress.failed_trials;
  const previous = activeProgressCheckpoint;
  const sameRun =
    previous.runId === progress.run_id;

  if (
    sameRun &&
    settledTrials - previous.settledTrials <
      CHECKPOINT_TRIAL_INTERVAL &&
    now - previous.savedAt <
      CHECKPOINT_INTERVAL_MS
  ) {
    return;
  }

  // Reserve the checkpoint before awaiting storage so concurrent updates do
  // not schedule equivalent writes.
  activeProgressCheckpoint = {
    runId: progress.run_id,
    settledTrials,
    savedAt: now,
  };

  try {
    const run = await loadActiveRun();
    if (!run) {
      throw new Error(
        'Active optimisation state disappeared while checkpointing ' +
          progress.run_id,
      );
    }

    if (
      run.config.run_id !== progress.run_id
    ) {
      throw new Error(
        'Active optimisation checkpoint belongs to ' +
          run.config.run_id +
          ', not ' +
          progress.run_id,
      );
    }

    await browser.storage.local.set({
      [ACTIVE_RUN_KEY]: {
        ...run,
        lastProgress:
          lightweightProgress(progress),
      },
    });
  } catch (cause) {
    if (
      activeProgressCheckpoint.runId ===
        progress.run_id &&
      activeProgressCheckpoint.savedAt === now
    ) {
      activeProgressCheckpoint = previous;
    }
    throw cause;
  }
};

export const loadActiveRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored =
      await browser.storage.local.get(
        ACTIVE_RUN_KEY,
      );
    const value = stored[ACTIVE_RUN_KEY];

    if (value === undefined) {
      return null;
    }

    return parsePersistedRun(
      value,
      'Active optimisation state',
    );
  };

const experimentFromRun = (
  run: PersistedOptimisationRun,
  progress: RunProgress,
  finishedAt: number,
): ExperimentRecord => ({
  version: 1,
  runId: progress.run_id,
  config: run.config,
  startedAt: run.startedAt,
  finishedAt,
  status: progress.status,
  completedTrials: progress.completed_trials,
  failedTrials: progress.failed_trials,
  reusedTrials: progress.reused_trials ?? 0,
  terminationReason:
    progress.termination_reason ?? null,
  best: progress.best,
  ...(run.environment
    ? {
        environment:
          run.environment,
      }
    : {}),
});

const saveExperiment = async (
  experiment: ExperimentRecord,
): Promise<void> => {
  const existing =
    await loadExperimentHistory();

  const next = [
    experiment,
    ...existing.filter(
      (item) =>
        item.runId !== experiment.runId,
    ),
  ]
    .sort(
      (left, right) =>
        right.finishedAt - left.finishedAt,
    )
    .slice(0, MAX_EXPERIMENTS);

  await browser.storage.local.set({
    [EXPERIMENTS_KEY]: next,
  });
};

export const finishActiveRun = async (
  progress: RunProgress,
): Promise<void> => {
  const run = await loadActiveRun();

  if (!run) {
    throw new Error(
      'Cannot finish optimisation ' +
        progress.run_id +
        ' because its persisted active state is missing',
    );
  }

  if (
    run.config.run_id !== progress.run_id
  ) {
    throw new Error(
      'Cannot finish optimisation ' +
        progress.run_id +
        ' while ' +
        run.config.run_id +
        ' is persisted as active',
    );
  }

  const finishedAt = Date.now();

  await browser.storage.local.set({
    [LAST_RUN_KEY]: {
      ...run,
      finishedAt,
      lastProgress: progress,
    },
  });

  await saveExperiment(
    experimentFromRun(
      run,
      progress,
      finishedAt,
    ),
  );

  await browser.storage.local.remove(
    ACTIVE_RUN_KEY,
  );
  resetActiveProgressCheckpoint();
};

export const clearActiveRun =
  async (): Promise<void> => {
    await browser.storage.local.remove(
      ACTIVE_RUN_KEY,
    );
    resetActiveProgressCheckpoint();
  };

export const loadLastRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored =
      await browser.storage.local.get(
        LAST_RUN_KEY,
      );
    const value = stored[LAST_RUN_KEY];

    if (value === undefined) {
      return null;
    }

    return parsePersistedRun(
      value,
      'Last optimisation state',
    );
  };

export const loadExperimentHistory =
  async (): Promise<ExperimentRecord[]> => {
    const stored =
      await browser.storage.local.get(
        EXPERIMENTS_KEY,
      );
    const value = stored[EXPERIMENTS_KEY];

    if (value === undefined) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new Error(
        'Experiment history is corrupted',
      );
    }

    for (const item of value) {
      if (!isExperimentRecord(item)) {
        throw new Error(
          'Experiment history contains a corrupted or incompatible record',
        );
      }
    }

    return [...value]
      .sort(
        (left, right) =>
          right.finishedAt - left.finishedAt,
      );
  };

const updateExperiment = async (
  runId: string,
  patch: Partial<
    Pick<
      ExperimentRecord,
      'analysis' | 'research'
    >
  >,
): Promise<void> => {
  const experiments =
    await loadExperimentHistory();
  const index = experiments.findIndex(
    (experiment) =>
      experiment.runId === runId,
  );

  if (index < 0) {
    throw new Error(
      'Experiment ' +
        runId +
        ' was not found in local history',
    );
  }

  const current = experiments[index];
  if (!current) {
    throw new Error(
      'Experiment history index became inconsistent',
    );
  }

  experiments[index] = {
    ...current,
    ...patch,
  };

  await browser.storage.local.set({
    [EXPERIMENTS_KEY]: experiments,
  });
};

export const updateExperimentAnalysis = (
  runId: string,
  analysis: RunAnalysis,
): Promise<void> =>
  updateExperiment(runId, { analysis });

export const updateExperimentResearch = (
  runId: string,
  research: ResearchEvaluation,
): Promise<void> =>
  updateExperiment(runId, { research });

export const deleteExperiment = async (
  runId: string,
): Promise<void> => {
  const experiments =
    await loadExperimentHistory();

  await browser.storage.local.set({
    [EXPERIMENTS_KEY]: experiments.filter(
      (experiment) =>
        experiment.runId !== runId,
    ),
  });
};
