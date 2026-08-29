import type {
  BestTrial,
  CreateRun,
  RunAnalysis,
  RunProgress,
  RunStatus,
} from '../protocol/types';
import type { ResearchEvaluation } from './research';

export interface RunEnvironment {
  extensionVersion: string;
  backendVersion?: string;
  optunaVersion?: string;
}

export interface PersistedOptimisationRun {
  version: 1;
  config: CreateRun;
  strategyId: string;
  originalParameters: Record<string, unknown>;
  startedAt: number;
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
    | 'user'
    | null;
  best: BestTrial | null;
  environment?: RunEnvironment;
  analysis?: RunAnalysis;
  research?: ResearchEvaluation;
}

const ACTIVE_RUN_KEY = 'activeOptimisationRun';
const LAST_RUN_KEY = 'lastOptimisationRun';
const EXPERIMENTS_KEY = 'optimisationExperimentsV1';
const MAX_EXPERIMENTS = 50;

export const saveActiveRun = async (
  run: PersistedOptimisationRun,
): Promise<void> => {
  await browser.storage.local.set({
    [ACTIVE_RUN_KEY]: run,
  });
};

export const updateActiveRunProgress = async (
  progress: RunProgress,
): Promise<void> => {
  const run = await loadActiveRun();
  if (
    !run ||
    run.config.run_id !== progress.run_id
  ) {
    return;
  }

  await saveActiveRun({
    ...run,
    lastProgress: progress,
  });
};

export const loadActiveRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored =
      await browser.storage.local.get(
        ACTIVE_RUN_KEY,
      );
    const value = stored[ACTIVE_RUN_KEY];

    if (
      !value ||
      typeof value !== 'object'
    ) {
      return null;
    }

    const run =
      value as Partial<PersistedOptimisationRun>;
    if (
      run.version !== 1 ||
      !run.config ||
      typeof run.strategyId !== 'string' ||
      typeof run.startedAt !== 'number' ||
      !run.originalParameters
    ) {
      return null;
    }

    return run as PersistedOptimisationRun;
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

  if (
    run &&
    run.config.run_id === progress.run_id
  ) {
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
  }

  await browser.storage.local.remove(
    ACTIVE_RUN_KEY,
  );
};

export const clearActiveRun =
  async (): Promise<void> => {
    await browser.storage.local.remove(
      ACTIVE_RUN_KEY,
    );
  };

export const loadLastRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored =
      await browser.storage.local.get(
        LAST_RUN_KEY,
      );
    const value = stored[LAST_RUN_KEY];

    if (
      !value ||
      typeof value !== 'object'
    ) {
      return null;
    }

    return value as PersistedOptimisationRun;
  };

export const loadExperimentHistory =
  async (): Promise<ExperimentRecord[]> => {
    const stored =
      await browser.storage.local.get(
        EXPERIMENTS_KEY,
      );
    const value = stored[EXPERIMENTS_KEY];

    if (!Array.isArray(value)) return [];

    return value
      .filter(
        (item): item is ExperimentRecord =>
          item !== null &&
          typeof item === 'object' &&
          (item as Partial<ExperimentRecord>)
            .version === 1 &&
          typeof (
            item as Partial<ExperimentRecord>
          ).runId === 'string',
      )
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

  if (index < 0) return;

  const current = experiments[index];
  if (!current) return;

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
