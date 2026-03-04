import type { ServiceWorkerMessage } from '../shared/messages';
import type { Metric, OptimizationConfig, OptimizationState, TrialHistoryRun, TrialResult } from '../shared/types';
import { sanitizeOptimizationConfigInput, sanitizeTrialParamsInput } from '../shared/config-schema';

const MAX_PERSISTED_TRIALS = 600;
const MAX_PERSISTED_HISTORY_RUNS = 80;
const MAX_PERSISTED_HISTORY_TRIALS = 300;
const MAX_HISTORY_SUMMARY_TRIALS_PER_RUN = 12;
const MAX_PERSISTED_METRICS_PER_TRIAL = 6;
const MAX_PERSISTED_FILTER_FAILURES = 6;
const MAX_PERSISTED_VALUE_CHARS = 80;
const PERSIST_DEBOUNCE_MS = 300;

const VALID_STATUSES: OptimizationState['status'][] = [
  'idle',
  'detecting',
  'running',
  'paused',
  'completed',
  'error',
];

function isOptimizationStatus(value: string): value is OptimizationState['status'] {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function truncateText(value: unknown, maxLen = MAX_PERSISTED_VALUE_CHARS): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

function sanitizePersistedMetric(raw: unknown): Metric | null {
  if (!isRecord(raw)) return null;

  const name = truncateText(raw.name, 120);
  const section = truncateText(raw.section, 120);
  const value = truncateText(raw.value, MAX_PERSISTED_VALUE_CHARS);
  if (!name || !section) return null;

  const numericValue =
    typeof raw.numericValue === 'number' && Number.isFinite(raw.numericValue) ? raw.numericValue : Number.NaN;
  const column = raw.column === 'long' || raw.column === 'short' ? raw.column : 'all';

  return {
    name,
    value,
    numericValue,
    column,
    section,
    currency: typeof raw.currency === 'string' ? truncateText(raw.currency, 16) : undefined,
    percentValue: typeof raw.percentValue === 'string' ? truncateText(raw.percentValue, 24) : undefined,
    isPositive: typeof raw.isPositive === 'boolean' ? raw.isPositive : undefined,
    isNegative: typeof raw.isNegative === 'boolean' ? raw.isNegative : undefined,
  };
}

function sanitizePersistedTrial(raw: unknown): TrialResult | null {
  if (!isRecord(raw)) return null;
  const params = sanitizeTrialParamsInput(raw.params);
  if (!params) return null;

  const objectiveValue =
    typeof raw.objectiveValue === 'number' && Number.isFinite(raw.objectiveValue) ? raw.objectiveValue : 0;
  const metrics = Array.isArray(raw.metrics)
    ? raw.metrics
        .map((metric) => sanitizePersistedMetric(metric))
        .filter((metric): metric is Metric => metric !== null)
        .slice(0, MAX_PERSISTED_METRICS_PER_TRIAL)
    : [];
  const filterFailures = Array.isArray(raw.filterFailures)
    ? raw.filterFailures
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.slice(0, 180))
        .slice(0, MAX_PERSISTED_FILTER_FAILURES)
    : [];

  return {
    trialNumber: clampNonNegativeInt(raw.trialNumber, 0),
    params,
    metrics,
    objectiveValue,
    passedFilters: Boolean(raw.passedFilters),
    filterFailures,
    timestamp: clampNonNegativeInt(raw.timestamp, Date.now()),
    duration: clampNonNegativeInt(raw.duration, 0),
  };
}

function compactHistoryTrialSummary(trial: TrialResult): TrialResult {
  return {
    ...trial,
    metrics: [],
    filterFailures: trial.filterFailures.slice(0, 2),
  };
}

function sanitizePersistedHistoryRun(raw: unknown): TrialHistoryRun | null {
  if (!isRecord(raw)) return null;

  const id = truncateText(raw.id, 180);
  const familyName = truncateText(raw.familyName, 120);
  const studyNameRaw = truncateText(raw.studyName, 120);
  const strategyName = truncateText(raw.strategyName, 120);
  const runMode = raw.runMode === 'resume' || raw.runMode === 'warm_start' ? raw.runMode : 'fresh';
  if (!id || !familyName) return null;

  const trials = Array.isArray(raw.trials)
    ? raw.trials
        .map((trial) => sanitizePersistedTrial(trial))
        .filter((trial): trial is TrialResult => trial !== null)
        .slice(-MAX_HISTORY_SUMMARY_TRIALS_PER_RUN)
        .map((trial) => compactHistoryTrialSummary(trial))
    : [];

  return {
    id,
    familyName,
    studyName: studyNameRaw || familyName,
    strategyName,
    runMode,
    startedAt: clampNonNegativeInt(raw.startedAt, Date.now()),
    completedAt: clampNonNegativeInt(raw.completedAt, Date.now()),
    trials,
  };
}

function sanitizePersistedConfig(raw: unknown): OptimizationConfig | null {
  if (!isRecord(raw)) return null;
  try {
    const now = Date.now();
    const sanitizedCore = sanitizeOptimizationConfigInput(raw);
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 120) : `opt_${now}`;
    const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now;
    const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;
    return {
      id,
      ...sanitizedCore,
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export interface StatePersistenceOptions {
  optimizationState: OptimizationState;
  storageKey: string;
  sendToSidePanel: (message: ServiceWorkerMessage) => void;
  logDebug: (...args: unknown[]) => void;
}

export interface StatePersistenceController {
  schedulePersist: (immediate?: boolean) => void;
  restoreState: () => Promise<void>;
}

export function createStatePersistence(options: StatePersistenceOptions): StatePersistenceController {
  const { optimizationState, storageKey, sendToSidePanel, logDebug } = options;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistFailureNotified = false;

  const buildPersistedStatePayload = () => {
    const persistedTrials = optimizationState.trials
      .map((trial) => sanitizePersistedTrial(trial))
      .filter((trial): trial is TrialResult => trial !== null)
      .slice(-MAX_PERSISTED_TRIALS);

    const persistedHistoryRuns = optimizationState.historyRuns
      .map((run) => sanitizePersistedHistoryRun(run))
      .filter((run): run is TrialHistoryRun => run !== null)
      .slice(0, MAX_PERSISTED_HISTORY_RUNS);

    const persistedHistoryTrials = optimizationState.historyTrials
      .map((trial) => sanitizePersistedTrial(trial))
      .filter((trial): trial is TrialResult => trial !== null)
      .slice(-MAX_PERSISTED_HISTORY_TRIALS)
      .map((trial) => compactHistoryTrialSummary(trial));

    return {
      status: optimizationState.status,
      currentTrial: optimizationState.currentTrial,
      totalTrials: optimizationState.config?.totalTrials ?? 0,
      bestTrial: sanitizePersistedTrial(optimizationState.bestTrial),
      trialsCount: optimizationState.trials.length,
      trials: persistedTrials,
      historyRuns: persistedHistoryRuns,
      historyTrials: persistedHistoryTrials,
      resumeAvailable: optimizationState.resumeAvailable,
      config: sanitizePersistedConfig(optimizationState.config),
      startTime: optimizationState.startTime,
      error: optimizationState.error,
    };
  };

  const flushPersistState = () => {
    chrome.storage.local
      .set({ [storageKey]: buildPersistedStatePayload() })
      .then(() => {
        persistFailureNotified = false;
      })
      .catch((err) => {
        console.error('[SW] Failed to persist optimization state:', err);
        if (persistFailureNotified) return;
        persistFailureNotified = true;
        sendToSidePanel({
          type: 'OPTIMIZATION_ERROR',
          error: 'Failed to persist optimization state.',
        });
      });
  };

  const schedulePersist = (immediate = false) => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (immediate) {
      flushPersistState();
      return;
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushPersistState();
    }, PERSIST_DEBOUNCE_MS);
  };

  const restoreState = async () => {
    try {
      const result = await chrome.storage.local.get(storageKey);
      const rawSaved = result[storageKey];
      if (!isRecord(rawSaved)) return;

      const rawStatus = typeof rawSaved.status === 'string' ? rawSaved.status : null;
      const savedStatus: OptimizationState['status'] | null = rawStatus && isOptimizationStatus(rawStatus) ? rawStatus : null;
      if (!savedStatus) return;

      const restoredTrials = Array.isArray(rawSaved.trials)
        ? rawSaved.trials
            .map((trial) => sanitizePersistedTrial(trial))
            .filter((trial): trial is TrialResult => trial !== null)
            .slice(-MAX_PERSISTED_TRIALS)
        : [];

      const restoredHistoryRuns = Array.isArray(rawSaved.historyRuns)
        ? rawSaved.historyRuns
            .map((run) => sanitizePersistedHistoryRun(run))
            .filter((run): run is TrialHistoryRun => run !== null)
            .slice(0, MAX_PERSISTED_HISTORY_RUNS)
        : [];

      const restoredHistoryTrials = Array.isArray(rawSaved.historyTrials)
        ? rawSaved.historyTrials
            .map((trial) => sanitizePersistedTrial(trial))
            .filter((trial): trial is TrialResult => trial !== null)
            .slice(-MAX_PERSISTED_HISTORY_TRIALS)
            .map((trial) => compactHistoryTrialSummary(trial))
        : [];

      const restoredBestTrial = sanitizePersistedTrial(rawSaved.bestTrial);
      const restoredConfig = sanitizePersistedConfig(rawSaved.config);
      const restoredCurrentTrial = clampNonNegativeInt(rawSaved.currentTrial, 0);
      const restoredStartTime =
        typeof rawSaved.startTime === 'number' && Number.isFinite(rawSaved.startTime) ? rawSaved.startTime : null;
      const restoredError = typeof rawSaved.error === 'string' ? rawSaved.error : null;
      const restoredResumeAvailable = Boolean(rawSaved.resumeAvailable ?? false);

      const applyRestoredState = ({
        status,
        error,
        resumeAvailable,
      }: {
        status: OptimizationState['status'];
        error: string | null;
        resumeAvailable: boolean;
      }) => {
        optimizationState.status = status;
        optimizationState.currentTrial = restoredCurrentTrial;
        optimizationState.trials = restoredTrials;
        optimizationState.historyRuns = restoredHistoryRuns;
        optimizationState.historyTrials = restoredHistoryTrials;
        optimizationState.bestTrial = restoredBestTrial;
        optimizationState.error = error;
        optimizationState.startTime = restoredStartTime;
        optimizationState.resumeAvailable = resumeAvailable;
        optimizationState.config = restoredConfig;
        optimizationState.pausedAt = null;
      };

      if (savedStatus === 'running' || savedStatus === 'paused') {
        applyRestoredState({
          status: 'error',
          error: 'Optimization interrupted (service worker restarted). Results up to this point are preserved.',
          resumeAvailable: true,
        });
        logDebug('[SW] Restored interrupted run as recoverable error state');
        return;
      }

      if (savedStatus === 'detecting') {
        applyRestoredState({
          status: 'idle',
          error: null,
          resumeAvailable: false,
        });
        logDebug('[SW] Restored transient detecting state as idle');
        return;
      }

      applyRestoredState({
        status: savedStatus,
        error: restoredError,
        resumeAvailable: restoredResumeAvailable,
      });
      logDebug(`[SW] Restored state: ${savedStatus}, ${restoredTrials.length} trials`);
    } catch (err) {
      console.warn('[SW] Failed to restore state:', err instanceof Error ? err.message : err);
    }
  };

  return {
    schedulePersist,
    restoreState,
  };
}
