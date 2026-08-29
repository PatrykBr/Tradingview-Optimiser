import type { CreateRun, RunProgress } from '../protocol/types';

export interface PersistedOptimisationRun {
  version: 1;
  config: CreateRun;
  strategyId: string;
  originalParameters: Record<string, unknown>;
  startedAt: number;
  finishedAt?: number;
  lastProgress?: RunProgress;
}

const ACTIVE_RUN_KEY = 'activeOptimisationRun';
const LAST_RUN_KEY = 'lastOptimisationRun';

export const saveActiveRun = async (
  run: PersistedOptimisationRun,
): Promise<void> => {
  await browser.storage.local.set({ [ACTIVE_RUN_KEY]: run });
};

export const updateActiveRunProgress = async (
  progress: RunProgress,
): Promise<void> => {
  const run = await loadActiveRun();
  if (!run || run.config.run_id !== progress.run_id) return;

  await saveActiveRun({
    ...run,
    lastProgress: progress,
  });
};

export const loadActiveRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored = await browser.storage.local.get(ACTIVE_RUN_KEY);
    const value = stored[ACTIVE_RUN_KEY];

    if (!value || typeof value !== 'object') return null;

    const run = value as Partial<PersistedOptimisationRun>;
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

export const finishActiveRun = async (
  progress: RunProgress,
): Promise<void> => {
  const run = await loadActiveRun();

  if (run && run.config.run_id === progress.run_id) {
    await browser.storage.local.set({
      [LAST_RUN_KEY]: {
        ...run,
        finishedAt: Date.now(),
        lastProgress: progress,
      },
    });
  }

  await browser.storage.local.remove(ACTIVE_RUN_KEY);
};

export const clearActiveRun = async (): Promise<void> => {
  await browser.storage.local.remove(ACTIVE_RUN_KEY);
};

export const loadLastRun =
  async (): Promise<PersistedOptimisationRun | null> => {
    const stored = await browser.storage.local.get(LAST_RUN_KEY);
    const value = stored[LAST_RUN_KEY];

    if (!value || typeof value !== 'object') return null;
    return value as PersistedOptimisationRun;
  };
