import { create } from 'zustand';
import type {
  OptimizationStatus,
  BackendStatus,
  StrategyParameter,
  StrategyInfo,
  TrialResult,
  TrialHistoryRun,
  Filter,
  AntiDetectionConfig,
  OptimizationConfig,
  SamplerChoice,
  RunMode,
  OptimizationState,
} from '../../shared/types';
import type { ServiceWorkerMessage, SidePanelMessage } from '../../shared/messages';
import { DEFAULT_ANTI_DETECTION, DEFAULT_TOTAL_TRIALS, STORAGE_KEYS } from '../../shared/constants';

const MIN_TOTAL_TRIALS = 1;
const MAX_TOTAL_TRIALS = 10000;
const DEFAULT_APPLY_PARAMS_ERROR = 'Failed to apply parameters';

function toggleStringSelection(values: string[], value: string): string[] {
  if (values.includes(value)) {
    return values.filter((entry) => entry !== value);
  }

  return [...values, value];
}

function clampTotalTrials(trials: number): number {
  return Math.min(MAX_TOTAL_TRIALS, Math.max(MIN_TOTAL_TRIALS, trials));
}

function resolveEffectiveRunMode(requestedRunMode: RunMode, selectedHistoryRunIds: string[]): RunMode {
  if (requestedRunMode === 'warm_start' && selectedHistoryRunIds.length === 0) {
    return 'fresh';
  }

  return requestedRunMode;
}

function updateArrayItemById<T extends { id: string }>(items: T[], id: string, updates: Partial<T>): T[] {
  return items.map((item) => {
    if (item.id !== id) {
      return item;
    }

    return { ...item, ...updates };
  });
}

function logDetectedParameterDiagnostics(source: string, strategyName: string, parameters: StrategyParameter[]): void {
  const sectionCounts = new Map<string, number>();
  const duplicateKeyCounts = new Map<string, number>();

  for (const param of parameters) {
    sectionCounts.set(param.section, (sectionCounts.get(param.section) ?? 0) + 1);
    const key = `${param.section}::${param.label}::${param.type}`;
    duplicateKeyCounts.set(key, (duplicateKeyCounts.get(key) ?? 0) + 1);
  }

  const sectionSummary = Array.from(sectionCounts.entries()).map(([section, count]) => ({
    section: section || 'General',
    count,
  }));
  const duplicateSummary = Array.from(duplicateKeyCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [section, label, type] = key.split('::');
      return {
        section: section || 'General',
        label,
        type,
        count,
      };
    });

  console.info(`[Store] [Detect] ${source} "${strategyName}" -> ${parameters.length} params`, sectionSummary);
  if (duplicateSummary.length > 0) {
    console.warn('[Store] [Detect] Repeated section/label/type entries detected', duplicateSummary);
  }
}

function mapConfigToStoreState(config: OptimizationState['config']): Partial<OptimizationStore> {
  if (!config) {
    return {};
  }

  return {
    selectedStrategyIndex: config.strategyIndex,
    strategyName: config.strategyName,
    runMode: config.runMode,
    selectedHistoryRunIds: config.selectedHistoryRunIds ?? [],
    sampler: config.sampler,
    targetMetric: config.targetMetric,
    targetMetricDirection: config.targetMetricDirection,
    targetMetricColumn: config.targetMetricColumn,
    totalTrials: config.totalTrials,
    parameters: config.parameters,
    filters: config.filters,
    antiDetection: config.antiDetection,
  };
}

function mapStatePatchToStoreState(patch: Partial<OptimizationState>): Partial<OptimizationStore> {
  const next: Partial<OptimizationStore> = {};
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.currentTrial !== undefined) next.currentTrial = patch.currentTrial;
  if (patch.trials !== undefined) next.trials = patch.trials;
  if (patch.historyTrials !== undefined) next.historyTrials = patch.historyTrials;
  if (patch.historyRuns !== undefined) next.historyRuns = patch.historyRuns;
  if (patch.resumeAvailable !== undefined) next.resumeAvailable = patch.resumeAvailable;
  if (patch.bestTrial !== undefined) next.bestTrial = patch.bestTrial;
  if (patch.error !== undefined) next.error = patch.error;
  if (patch.startTime !== undefined) next.startTime = patch.startTime;
  if (patch.config !== undefined) Object.assign(next, mapConfigToStoreState(patch.config));
  return next;
}

function tryPostMessage(port: chrome.runtime.Port, message: SidePanelMessage): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch (err) {
    console.warn('[Store] Failed to post message to service worker:', err);
    return false;
  }
}

function hasTrialWithNumber(trials: TrialResult[], trialNumber: number): boolean {
  return trials.some((trial) => trial.trialNumber === trialNumber);
}

interface OptimizationStore {
  backendStatus: BackendStatus;
  port: chrome.runtime.Port | null;
  strategies: StrategyInfo[];
  selectedStrategyIndex: number | null;
  strategyName: string;
  detectedParameters: StrategyParameter[];
  isDetecting: boolean;
  isListingStrategies: boolean;
  targetMetric: string;
  targetMetricDirection: 'maximize' | 'minimize';
  targetMetricColumn: 'all' | 'long' | 'short';
  runMode: RunMode;
  selectedHistoryRunIds: string[];
  sampler: SamplerChoice;
  totalTrials: number;
  parameters: StrategyParameter[];
  filters: Filter[];
  antiDetection: AntiDetectionConfig;
  favoriteMetrics: string[];
  status: OptimizationStatus;
  currentTrial: number;
  trials: TrialResult[];
  historyTrials: TrialResult[];
  historyRuns: TrialHistoryRun[];
  resumeAvailable: boolean;
  bestTrial: TrialResult | null;
  error: string | null;
  startTime: number | null;
  applyParamsStatus: 'idle' | 'applying' | 'success' | 'error';
  applyParamsError: string | null;
  init: () => void;
  disconnect: () => void;
  retryBackend: () => void;
  setTargetMetric: (metric: string, direction: 'maximize' | 'minimize') => void;
  setTargetMetricColumn: (column: 'all' | 'long' | 'short') => void;
  setRunMode: (runMode: RunMode) => void;
  setSelectedHistoryRunIds: (runIds: string[]) => void;
  toggleHistoryRunSelection: (runId: string) => void;
  clearHistoryRunSelection: () => void;
  setSampler: (sampler: SamplerChoice) => void;
  setTotalTrials: (trials: number) => void;
  setParameters: (params: StrategyParameter[]) => void;
  updateParameter: (id: string, updates: Partial<StrategyParameter>) => void;
  setFilters: (filters: Filter[]) => void;
  addFilter: (filter: Filter) => void;
  removeFilter: (id: string) => void;
  updateFilter: (id: string, updates: Partial<Filter>) => void;
  setAntiDetection: (config: AntiDetectionConfig) => void;
  toggleFavoriteMetric: (metric: string) => void;
  listStrategies: () => void;
  selectStrategy: (index: number) => void;
  detectParameters: () => void;
  startOptimization: (modeOverride?: RunMode) => void;
  pauseOptimization: () => void;
  resumeOptimization: () => void;
  stopOptimization: () => void;
  clearHistory: (familyOnly?: boolean) => void;
  deleteHistoryRun: (runId: string) => void;
  applyBestParams: () => void;
  clearApplyParamsStatus: () => void;
  resetState: () => void;
}

export const useOptimizationStore = create<OptimizationStore>((set, get) => {
  function connectPort(options?: {
    requestState?: boolean;
    requestBackendCheck?: boolean;
  }): chrome.runtime.Port {
    const requestState = options?.requestState ?? false;
    const requestBackendCheck = options?.requestBackendCheck ?? false;

    const existing = get().port;
    if (existing) {
      if (requestState) tryPostMessage(existing, { type: 'GET_STATE' });
      if (requestBackendCheck) tryPostMessage(existing, { type: 'CHECK_BACKEND' });
      return existing;
    }

    const port = chrome.runtime.connect({ name: 'sidepanel' });

    const handleStateUpdateMessage = (msg: Extract<ServiceWorkerMessage, { type: 'STATE_UPDATE' }>) => {
      set({
        status: msg.state.status,
        currentTrial: msg.state.currentTrial,
        trials: msg.state.trials,
        historyTrials: msg.state.historyTrials ?? [],
        historyRuns: msg.state.historyRuns ?? [],
        resumeAvailable: msg.state.resumeAvailable ?? false,
        bestTrial: msg.state.bestTrial,
        error: msg.state.error,
        startTime: msg.state.startTime,
        ...mapConfigToStoreState(msg.state.config),
      });
    };

    const handleStatePatchMessage = (msg: Extract<ServiceWorkerMessage, { type: 'STATE_PATCH' }>) => {
      const nextState = mapStatePatchToStoreState(msg.patch);
      if (Object.keys(nextState).length > 0) {
        set(nextState);
      }
    };

    const handleTrialCompleteMessage = (msg: Extract<ServiceWorkerMessage, { type: 'TRIAL_COMPLETE' }>) => {
      set((s) => {
        const exists = hasTrialWithNumber(s.trials, msg.trial.trialNumber);
        if (exists) return s;
        return { trials: [...s.trials, msg.trial] };
      });
    };

    const messageHandlers = {
      BACKEND_STATUS: (msg: Extract<ServiceWorkerMessage, { type: 'BACKEND_STATUS' }>) =>
        set({ backendStatus: msg.status }),
      STRATEGIES_LISTED: (msg: Extract<ServiceWorkerMessage, { type: 'STRATEGIES_LISTED' }>) =>
        set({ strategies: msg.strategies, isListingStrategies: false }),
      STRATEGIES_ERROR: (msg: Extract<ServiceWorkerMessage, { type: 'STRATEGIES_ERROR' }>) =>
        set({ isListingStrategies: false, error: msg.error }),
      PARAMETERS_DETECTED: (msg: Extract<ServiceWorkerMessage, { type: 'PARAMETERS_DETECTED' }>) => {
        logDetectedParameterDiagnostics('sw_message', msg.strategyName, msg.parameters);
        set({
          detectedParameters: msg.parameters,
          parameters: msg.parameters,
          strategyName: msg.strategyName,
          isDetecting: false,
          status: 'idle',
        });
      },
      DETECTION_ERROR: (msg: Extract<ServiceWorkerMessage, { type: 'DETECTION_ERROR' }>) =>
        set({ isDetecting: false, error: msg.error, status: 'idle' }),
      STATE_UPDATE: handleStateUpdateMessage,
      STATE_PATCH: handleStatePatchMessage,
      TRIAL_COMPLETE: handleTrialCompleteMessage,
      OPTIMIZATION_COMPLETE: (msg: Extract<ServiceWorkerMessage, { type: 'OPTIMIZATION_COMPLETE' }>) =>
        set({ status: 'completed', bestTrial: msg.bestTrial }),
      OPTIMIZATION_ERROR: (msg: Extract<ServiceWorkerMessage, { type: 'OPTIMIZATION_ERROR' }>) =>
        set({
          status: 'error',
          error: msg.error,
          applyParamsStatus: 'error',
          applyParamsError: msg.error,
        }),
      PARAMS_APPLIED: (msg: Extract<ServiceWorkerMessage, { type: 'PARAMS_APPLIED' }>) => {
        if (msg.success) {
          set({
            applyParamsStatus: 'success',
            applyParamsError: msg.error ?? null,
          });
          return;
        }
        set({
          applyParamsStatus: 'error',
          applyParamsError: msg.error ?? DEFAULT_APPLY_PARAMS_ERROR,
          error: msg.error ?? DEFAULT_APPLY_PARAMS_ERROR,
        });
      },
    } satisfies {
      [K in ServiceWorkerMessage['type']]: (msg: Extract<ServiceWorkerMessage, { type: K }>) => void;
    };

    port.onMessage.addListener((msg: ServiceWorkerMessage) => {
      const handler = messageHandlers[msg.type] as (message: ServiceWorkerMessage) => void;
      handler(msg);
    });

    port.onDisconnect.addListener(() => {
      set({ port: null, backendStatus: 'disconnected' });
    });

    set({ port });

    if (requestState) tryPostMessage(port, { type: 'GET_STATE' });
    if (requestBackendCheck) tryPostMessage(port, { type: 'CHECK_BACKEND' });

    chrome.storage.local.get(STORAGE_KEYS.FAVORITE_METRICS, (result) => {
      const favorites = result[STORAGE_KEYS.FAVORITE_METRICS];
      if (Array.isArray(favorites)) {
        set({ favoriteMetrics: favorites as string[] });
      }
    });

    return port;
  }

  function dispatchSidePanelMessage(
    message: SidePanelMessage,
    fallbackState?: Partial<OptimizationStore>,
  ): boolean {
    function applyFallback(defaultState: Partial<OptimizationStore>): void {
      set(fallbackState ?? defaultState);
    }

    const currentPort = get().port;
    if (currentPort && tryPostMessage(currentPort, message)) {
      return true;
    }

    if (currentPort) {
      try {
        currentPort.disconnect();
      } catch {
        // Ignore failures while replacing a stale port.
      }
      set({ port: null, backendStatus: 'disconnected' });
    }

    let nextPort: chrome.runtime.Port;
    try {
      nextPort = connectPort({ requestState: false, requestBackendCheck: false });
    } catch (err) {
      console.error('[Store] Failed to reconnect service worker port:', err);
      applyFallback({ error: 'Lost connection to extension background service. Reopen the side panel and retry.' });
      return false;
    }

    if (!tryPostMessage(nextPort, message)) {
      applyFallback({ error: 'Could not deliver command to background service. Please retry.' });
      return false;
    }

    return true;
  }

  return {
    backendStatus: 'disconnected',
    port: null,
    strategies: [],
    selectedStrategyIndex: null,
    strategyName: '',
    detectedParameters: [],
    isDetecting: false,
    isListingStrategies: false,
    targetMetric: 'Profit factor',
    targetMetricDirection: 'maximize',
    targetMetricColumn: 'all',
    runMode: 'fresh',
    selectedHistoryRunIds: [],
    sampler: 'auto',
    totalTrials: DEFAULT_TOTAL_TRIALS,
    parameters: [],
    filters: [],
    antiDetection: { ...DEFAULT_ANTI_DETECTION },
    favoriteMetrics: [],
    status: 'idle',
    currentTrial: 0,
    trials: [],
    historyTrials: [],
    historyRuns: [],
    resumeAvailable: false,
    bestTrial: null,
    error: null,
    startTime: null,
    applyParamsStatus: 'idle',
    applyParamsError: null,
    init: () => connectPort({ requestState: true, requestBackendCheck: true }),
    disconnect: () => {
      const { port } = get();
      port?.disconnect();
      set({ port: null });
    },
    retryBackend: () => {
      set({ backendStatus: 'connecting' });
      dispatchSidePanelMessage({ type: 'CHECK_BACKEND' }, { backendStatus: 'disconnected' });
    },
    setTargetMetric: (metric, direction) => set({ targetMetric: metric, targetMetricDirection: direction }),
    setTargetMetricColumn: (column) => set({ targetMetricColumn: column }),
    setRunMode: (runMode) => set({ runMode }),
    setSelectedHistoryRunIds: (selectedHistoryRunIds) => set({ selectedHistoryRunIds }),
    toggleHistoryRunSelection: (runId) =>
      set((s) => ({
        selectedHistoryRunIds: toggleStringSelection(s.selectedHistoryRunIds, runId),
      })),
    clearHistoryRunSelection: () => set({ selectedHistoryRunIds: [] }),
    setSampler: (sampler) => set({ sampler }),
    setTotalTrials: (trials) => set({ totalTrials: clampTotalTrials(trials) }),
    setParameters: (parameters) => set({ parameters }),
    updateParameter: (id, updates) =>
      set((s) => ({
        parameters: updateArrayItemById<StrategyParameter>(s.parameters, id, updates),
      })),
    setFilters: (filters) => set({ filters }),
    addFilter: (filter) => set((s) => ({ filters: [...s.filters, filter] })),
    removeFilter: (id) => set((s) => ({ filters: s.filters.filter((f) => f.id !== id) })),
    updateFilter: (id, updates) =>
      set((s) => ({
        filters: updateArrayItemById<Filter>(s.filters, id, updates),
      })),
    setAntiDetection: (config) => set({ antiDetection: config }),
    toggleFavoriteMetric: (metric) =>
      set((s) => {
        const favorites = toggleStringSelection(s.favoriteMetrics, metric);
        chrome.storage.local
          .set({ [STORAGE_KEYS.FAVORITE_METRICS]: favorites })
          .catch((err) => console.error('[Store] Failed to persist favorite metrics:', err));
        return { favoriteMetrics: favorites };
      }),
    listStrategies: () => {
      set({ isListingStrategies: true, error: null, strategies: [] });
      dispatchSidePanelMessage(
        { type: 'LIST_STRATEGIES' },
        {
          isListingStrategies: false,
          error: 'Could not request strategy list from background service.',
        },
      );
    },
    selectStrategy: (index) => {
      const { strategies } = get();
      const strategy = strategies.find((s) => s.index === index);
      set({
        selectedStrategyIndex: index,
        strategyName: strategy?.name ?? '',
        parameters: [],
        detectedParameters: [],
      });
    },
    detectParameters: () => {
      const { selectedStrategyIndex } = get();
      if (selectedStrategyIndex === null) {
        set({ error: 'Select a strategy first' });
        return;
      }
      set({ isDetecting: true, error: null, status: 'detecting' });
      dispatchSidePanelMessage(
        { type: 'DETECT_PARAMETERS', strategyIndex: selectedStrategyIndex },
        {
          isDetecting: false,
          status: 'idle',
          error: 'Could not request parameter detection from background service.',
        },
      );
    },
    startOptimization: (modeOverride) => {
      const state = get();
      const now = Date.now();
      const requestedRunMode = modeOverride ?? state.runMode;
      const normalizedSelectedHistoryRunIds = state.selectedHistoryRunIds.filter(
        (id) => typeof id === 'string' && id.length > 0,
      );
      const effectiveRunMode = resolveEffectiveRunMode(requestedRunMode, normalizedSelectedHistoryRunIds);
      if (state.selectedStrategyIndex === null) {
        set({ error: 'Select a strategy first' });
        return;
      }
      const config: OptimizationConfig = {
        id: `opt_${now}`,
        name: `${state.strategyName} optimization`,
        strategyName: state.strategyName,
        strategyIndex: state.selectedStrategyIndex,
        runMode: effectiveRunMode,
        selectedHistoryRunIds: normalizedSelectedHistoryRunIds,
        sampler: state.sampler,
        targetMetric: state.targetMetric,
        targetMetricDirection: state.targetMetricDirection,
        targetMetricColumn: state.targetMetricColumn,
        totalTrials: state.totalTrials,
        parameters: state.parameters,
        filters: state.filters,
        antiDetection: state.antiDetection,
        createdAt: now,
        updatedAt: now,
      };

      if (
        !dispatchSidePanelMessage(
          { type: 'START_OPTIMIZATION', config },
          {
            status: 'idle',
            error: 'Could not start optimization because background service is unavailable.',
          },
        )
      ) {
        return;
      }
      set({
        status: 'running',
        trials: [],
        historyTrials: [],
        bestTrial: null,
        error: null,
        currentTrial: 0,
        applyParamsStatus: 'idle',
        applyParamsError: null,
      });
    },
    pauseOptimization: () => {
      dispatchSidePanelMessage({ type: 'PAUSE_OPTIMIZATION' });
    },
    resumeOptimization: () => {
      dispatchSidePanelMessage({ type: 'RESUME_OPTIMIZATION' });
    },
    stopOptimization: () => {
      dispatchSidePanelMessage({ type: 'STOP_OPTIMIZATION' });
    },
    clearHistory: (familyOnly = false) => {
      dispatchSidePanelMessage({ type: 'CLEAR_TRIAL_HISTORY', familyOnly });
    },
    deleteHistoryRun: (runId) => {
      dispatchSidePanelMessage({ type: 'DELETE_HISTORY_RUN', runId });
    },
    applyBestParams: () => {
      const { bestTrial } = get();
      if (!bestTrial) {
        console.warn('[Store] applyBestParams called but no bestTrial exists');
        set({
          applyParamsStatus: 'error',
          applyParamsError: 'No best trial available to apply.',
        });
        return;
      }
      set({ applyParamsStatus: 'applying', applyParamsError: null });
      dispatchSidePanelMessage(
        { type: 'APPLY_BEST_PARAMS', params: bestTrial.params },
        {
          applyParamsStatus: 'error',
          applyParamsError: 'Could not send apply-parameters command to background service.',
        },
      );
    },
    clearApplyParamsStatus: () => set({ applyParamsStatus: 'idle', applyParamsError: null }),
    resetState: () => {
      const { status } = get();
      if (status === 'running' || status === 'paused') {
        dispatchSidePanelMessage({ type: 'STOP_OPTIMIZATION' });
      }
      set({
        status: 'idle',
        currentTrial: 0,
        trials: [],
        historyTrials: [],
        bestTrial: null,
        error: null,
        startTime: null,
        applyParamsStatus: 'idle',
        applyParamsError: null,
      });
    },
  };
});
