/**
 * Background Service Worker
 *
 * Responsibilities:
 * - Open side panel on action click
 * - Detect side panel open/close for pause/resume
 * - Relay messages between side panel and content script
 * - Manage WebSocket connection to Python backend
 * - Orchestrate the optimization loop
 */

import { BACKEND_HEALTH_URL, BACKEND_WS_URL, DEFAULT_ANTI_DETECTION, MAX_BACKEND_MESSAGE_BYTES, STORAGE_KEYS } from '../shared/constants';
import type {
  SidePanelMessage,
  ServiceWorkerMessage,
  ContentScriptCommand,
  ContentScriptResponse,
  WarmStartTrialSeed,
  SearchSpaceParam,
} from '../shared/messages';
import type {
  OptimizationState,
  OptimizationConfig,
  TrialHistoryRun,
  Metric,
  BackendStatus,
  TrialParams,
  Filter,
  FilterOperator,
  StrategyParameter,
} from '../shared/types';
import { sanitizeOptimizationConfigInput } from '../shared/config-schema';
import { buildSearchSpace, resolveFamilyName, resolveStudyIdentity } from '../shared/study-signature';
import { isTradingViewChartUrl } from '../shared/tradingview-url';
import { randomDelay } from '../utils/delay';
import { parseSidePanelMessage } from './protocol';
import { createPauseController } from './pause-controller';
import {
  buildWarmStartSeedTrials as buildWarmStartSeedTrialsFromRuns,
  pruneSelectedHistoryRunIds,
  recomputeVisibleHistoryTrials as deriveVisibleHistoryTrials,
  resolveWarmStartSourceRuns as deriveWarmStartSourceRuns,
} from './history';
import { BackendClient, sendBackendMaintenanceMessage as sendMaintenanceCommand } from './backend-client';
import { createStatePersistence } from './state-persistence';
import { runOptimizationTrials } from './optimization-runner';

type MetricComparator = (actual: number, expected: number) => boolean;

// ============================================================
// State
// ============================================================

let sidePanelPort: chrome.runtime.Port | null = null;
let backendClient: BackendClient | null = null;
let backendStatus: BackendStatus = 'disconnected';
let currentStudyName: string | null = null;
let currentStudyFamily: string | null = null;

const MAX_WARM_START_SEEDS = 5000;
const MAX_INIT_MESSAGE_BYTES = Math.floor(MAX_BACKEND_MESSAGE_BYTES * 0.85);
const MAX_PERSISTED_HISTORY_RUNS = 100;
const DEBUG_LOGS = import.meta.env.DEV;
const FILTER_COMPARATORS = {
  '>=': (actual: number, expected: number) => actual >= expected,
  '<=': (actual: number, expected: number) => actual <= expected,
  '>': (actual: number, expected: number) => actual > expected,
  '<': (actual: number, expected: number) => actual < expected,
  '==': (actual: number, expected: number) => actual === expected,
  '!=': (actual: number, expected: number) => actual !== expected,
} satisfies Record<FilterOperator, MetricComparator>;

let shouldStop = false;
const pauseController = createPauseController();

// Store the active TradingView tab ID at optimization start (H4)
let optimizationTabId: number | null = null;
let boundTradingViewTabId: number | null = null;

const optimizationState: OptimizationState = {
  status: 'idle',
  config: null,
  currentTrial: 0,
  trials: [],
  historyTrials: [],
  historyRuns: [],
  resumeAvailable: false,
  bestTrial: null,
  error: null,
  startTime: null,
  pausedAt: null,
};

const statePersistence = createStatePersistence({
  optimizationState,
  storageKey: STORAGE_KEYS.LAST_OPTIMIZATION_STATE,
  sendToSidePanel: (message) => sendToSidePanel(message),
  logDebug,
});

// Keep-alive alarm name (C3)
const KEEPALIVE_ALARM = 'sw-keepalive';

// WebSocket keepalive interval (Chrome docs recommend < 30s)
let wsKeepaliveInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================
// Service Worker Lifecycle (C3)
// ============================================================

// Restore state on service worker startup
statePersistence.restoreState();

// Keep-alive: Chrome can kill MV3 service workers after 30s idle.
// Use alarms to stay alive during optimization.
function startKeepalive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24s
}

/** Start WebSocket keepalive — call AFTER init handshake to avoid
 * status responses interfering with the init_ack. */
function startWsKeepalive() {
  stopWsKeepalive();
  wsKeepaliveInterval = setInterval(() => {
    if (backendClient?.isConnected()) {
      try {
        backendClient.sendFireAndForget({ type: 'status' });
      } catch {
        // Ignore keepalive send failures.
      }
    }
  }, 20000); // 20s as recommended by Chrome docs
}

function stopKeepalive() {
  chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {});
  stopWsKeepalive();
}

function stopWsKeepalive() {
  if (wsKeepaliveInterval) {
    clearInterval(wsKeepaliveInterval);
    wsKeepaliveInterval = null;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Just touching the service worker keeps it alive
    logDebug('[SW] Keepalive ping');
  }
});

// ============================================================
// Side Panel Lifecycle
// ============================================================

// Open side panel when the action button is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Note: Side panel is enabled on all pages. The content script and UI handle
// the "not on TradingView" case with appropriate error messages.

// Track side panel connection via port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    if (port.sender?.id !== chrome.runtime.id) {
      console.warn('[SW] Rejected side panel port from unexpected sender');
      try {
        port.disconnect();
      } catch {}
      return;
    }
    sidePanelPort = port;
    logDebug('[SW] Side panel connected');

    // If we were paused due to panel close, resume
    if (optimizationState.status === 'paused' && optimizationState.pausedAt) {
      resumeOptimizationLoop();
    }

    // Send current state to the panel
    sendStateUpdate();
    sendBackendStatus();

    port.onMessage.addListener((raw: unknown) => {
      let msg: SidePanelMessage | null = null;
      try {
        msg = parseSidePanelMessage(raw);
      } catch (err) {
        console.warn('[SW] Failed to parse side panel message:', err);
        msg = null;
      }
      if (!msg) {
        console.warn('[SW] Rejected invalid side panel message payload');
        sendToSidePanel({
          type: 'OPTIMIZATION_ERROR',
          error: 'Invalid side panel message payload',
        });
        return;
      }
      handleSidePanelMessage(msg).catch((err) => {
        console.error('[SW] Error handling side panel message:', err);
        sendToSidePanel({
          type: 'OPTIMIZATION_ERROR',
          error: toErrorMessage(err, 'Internal service worker error'),
        });
      });
    });

    port.onDisconnect.addListener(() => {
      logDebug('[SW] Side panel disconnected');
      sidePanelPort = null;

      // Auto-pause if optimization is running
      if (optimizationState.status === 'running') {
        pauseOptimizationLoop();
        optimizationState.pausedAt = Date.now();
        statePersistence.schedulePersist();
      }
    });
  }
});

// ============================================================
// Pause/Resume Helpers
// ============================================================

function pauseOptimizationLoop() {
  pauseController.pause();
  optimizationState.status = 'paused';
}

function resumeOptimizationLoop() {
  pauseController.resume();
  optimizationState.status = 'running';
  optimizationState.pausedAt = null;
}

function waitForUnpause(): Promise<void> {
  if (shouldStop) {
    return Promise.reject(new Error('Optimization stopped'));
  }
  return pauseController.waitForResume();
}

// ============================================================
// Message Handling
// ============================================================

function logDebug(...args: unknown[]) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

async function getBoundOrActiveTradingViewTabId(preferBound = true): Promise<number> {
  if (preferBound && boundTradingViewTabId !== null) {
    try {
      const existing = await chrome.tabs.get(boundTradingViewTabId);
      if (existing.id !== undefined && isTradingViewChartUrl(existing.url)) {
        return existing.id;
      }
      boundTradingViewTabId = null;
    } catch {
      boundTradingViewTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTradingViewTab = tabs.find((tab) => tab.id !== undefined && isTradingViewChartUrl(tab.url));
  if (!activeTradingViewTab?.id) {
    throw new Error('No active TradingView tab found. Focus a TradingView chart tab and retry.');
  }
  boundTradingViewTabId = activeTradingViewTab.id;
  return activeTradingViewTab.id;
}

async function assertOptimizationTab(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error('Selected TradingView tab is no longer available.');
  }
  if (!isTradingViewChartUrl(tab.url)) {
    throw new Error('Selected tab is no longer a TradingView tab. Focus the intended chart and retry.');
  }
}

function sendToSidePanel(msg: ServiceWorkerMessage) {
  try {
    sidePanelPort?.postMessage(msg);
  } catch {
    // Port may have disconnected
  }
}

function sendStateUpdate() {
  sendToSidePanel({ type: 'STATE_UPDATE', state: { ...optimizationState } });
}

function sendBackendStatus(status: BackendStatus = backendStatus) {
  sendToSidePanel({ type: 'BACKEND_STATUS', status });
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function logDetectionDiagnostics(source: string, strategyName: string, parameters: StrategyParameter[]) {
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

  logDebug(`[SW] [Detect] ${source} "${strategyName}" -> ${parameters.length} params`, sectionSummary);
  if (duplicateSummary.length > 0) {
    console.warn('[SW] [Detect] Repeated section/label/type entries detected', duplicateSummary);
  }
}

function sendStatePatch(patch: Partial<OptimizationState>) {
  sendToSidePanel({ type: 'STATE_PATCH', patch });
}

async function sendToContentScript(tabId: number, msg: ContentScriptCommand): Promise<ContentScriptResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response: ContentScriptResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function resolveTradingViewTabId(): Promise<number> {
  const tabId = await getBoundOrActiveTradingViewTabId(true);
  boundTradingViewTabId = tabId;
  logDebug('[SW] Using TradingView tab:', tabId);
  return tabId;
}

const sidePanelMessageHandlers = {
  CHECK_BACKEND: async (_msg: Extract<SidePanelMessage, { type: 'CHECK_BACKEND' }>) => {
    await checkBackendHealth();
  },
  LIST_STRATEGIES: async (_msg: Extract<SidePanelMessage, { type: 'LIST_STRATEGIES' }>) => {
    await fetchStrategies();
  },
  DETECT_PARAMETERS: async (msg: Extract<SidePanelMessage, { type: 'DETECT_PARAMETERS' }>) => {
    await detectParameters(msg.strategyIndex);
  },
  START_OPTIMIZATION: async (msg: Extract<SidePanelMessage, { type: 'START_OPTIMIZATION' }>) => {
    if (!['idle', 'completed', 'error'].includes(optimizationState.status)) {
      throw new Error(`Cannot start optimization while status is "${optimizationState.status}".`);
    }
    await startOptimization(msg.config);
  },
  PAUSE_OPTIMIZATION: async (_msg: Extract<SidePanelMessage, { type: 'PAUSE_OPTIMIZATION' }>) => {
    pauseOptimizationLoop();
    optimizationState.pausedAt = Date.now();
    sendStateUpdate();
    statePersistence.schedulePersist();
  },
  RESUME_OPTIMIZATION: async (_msg: Extract<SidePanelMessage, { type: 'RESUME_OPTIMIZATION' }>) => {
    resumeOptimizationLoop();
    sendStateUpdate();
  },
  STOP_OPTIMIZATION: async (_msg: Extract<SidePanelMessage, { type: 'STOP_OPTIMIZATION' }>) => {
    shouldStop = true;
    pauseController.stop();
    upsertCurrentRunIntoHistory();
    recomputeVisibleHistoryTrials();
    optimizationState.status = 'completed';
    optimizationState.resumeAvailable = false;
    sendStateUpdate();
    sendToSidePanel({
      type: 'OPTIMIZATION_COMPLETE',
      bestTrial: optimizationState.bestTrial,
    });
    statePersistence.schedulePersist(true);
    stopKeepalive();
  },
  CLEAR_TRIAL_HISTORY: async (msg: Extract<SidePanelMessage, { type: 'CLEAR_TRIAL_HISTORY' }>) => {
    await clearTrialHistory(Boolean(msg.familyOnly));
  },
  DELETE_HISTORY_RUN: async (msg: Extract<SidePanelMessage, { type: 'DELETE_HISTORY_RUN' }>) => {
    await deleteHistoryRun(msg.runId);
  },
  APPLY_BEST_PARAMS: async (msg: Extract<SidePanelMessage, { type: 'APPLY_BEST_PARAMS' }>) => {
    await applyParams(msg.params);
  },
  GET_STATE: async (_msg: Extract<SidePanelMessage, { type: 'GET_STATE' }>) => {
    sendStateUpdate();
    sendBackendStatus();
  },
} satisfies {
  [K in SidePanelMessage['type']]: (msg: Extract<SidePanelMessage, { type: K }>) => Promise<void>;
};

async function handleSidePanelMessage(msg: SidePanelMessage) {
  const handler = sidePanelMessageHandlers[msg.type] as (message: SidePanelMessage) => Promise<void>;
  await handler(msg);
}

// ============================================================
// Backend WebSocket
// ============================================================

async function checkBackendHealth() {
  try {
    const response = await fetch(BACKEND_HEALTH_URL);
    const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
    const ready = typeof payload.ready === 'boolean' ? payload.ready : response.ok;
    if (response.ok && ready) {
      backendStatus = 'connected';
      logDebug('[SW] Backend health check OK');
    } else {
      backendStatus = 'error';
      console.warn('[SW] Backend health check failed:', response.status, payload);
    }
  } catch (err) {
    backendStatus = 'disconnected';
    console.warn('[SW] Backend health check error:', toErrorMessage(err, String(err)));
  }
  sendBackendStatus();
}

function ensureBackendClient(): BackendClient {
  if (backendClient) return backendClient;
  backendClient = new BackendClient({
    baseWsUrl: BACKEND_WS_URL,
    maxMessageBytes: MAX_BACKEND_MESSAGE_BYTES,
    onStatusChange: (status) => {
      backendStatus = status;
      sendBackendStatus(status);
    },
    onDebug: (...args) => logDebug(...args),
  });
  return backendClient;
}

type InitRequestPayload = {
  type: 'init';
  study_name: string;
  study_family: string;
  direction: OptimizationConfig['targetMetricDirection'];
  search_space: SearchSpaceParam[];
  sampler: OptimizationConfig['sampler'];
  run_mode: OptimizationConfig['runMode'];
  warm_start_trials?: WarmStartTrialSeed[];
};

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function estimateInitPayloadBytes(payload: InitRequestPayload): number {
  return serializedBytes({
    ...payload,
    request_id: 'init_probe_payload_size',
  });
}

function applyInitPayloadBudget(
  basePayload: Omit<InitRequestPayload, 'warm_start_trials'>,
  warmStartSeeds: WarmStartTrialSeed[] | undefined,
): { payload: InitRequestPayload; droppedSeeds: number; payloadBytes: number } {
  if (!warmStartSeeds || warmStartSeeds.length === 0) {
    const payload: InitRequestPayload = { ...basePayload };
    return {
      payload,
      droppedSeeds: 0,
      payloadBytes: estimateInitPayloadBytes(payload),
    };
  }

  const fullPayload: InitRequestPayload = {
    ...basePayload,
    warm_start_trials: warmStartSeeds,
  };
  const fullBytes = estimateInitPayloadBytes(fullPayload);
  if (fullBytes <= MAX_INIT_MESSAGE_BYTES) {
    return {
      payload: fullPayload,
      droppedSeeds: 0,
      payloadBytes: fullBytes,
    };
  }

  let low = 0;
  let high = warmStartSeeds.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const candidatePayload: InitRequestPayload = {
      ...basePayload,
      warm_start_trials: warmStartSeeds.slice(warmStartSeeds.length - mid),
    };
    if (estimateInitPayloadBytes(candidatePayload) <= MAX_INIT_MESSAGE_BYTES) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const keptSeeds = low > 0 ? warmStartSeeds.slice(warmStartSeeds.length - low) : undefined;
  const payload: InitRequestPayload = keptSeeds ? { ...basePayload, warm_start_trials: keptSeeds } : { ...basePayload };
  const payloadBytes = estimateInitPayloadBytes(payload);
  if (payloadBytes > MAX_INIT_MESSAGE_BYTES) {
    throw new Error('Warm-start init payload still exceeds backend message budget. Reduce selected history runs.');
  }

  return {
    payload,
    droppedSeeds: warmStartSeeds.length - (keptSeeds?.length ?? 0),
    payloadBytes,
  };
}

// ============================================================
// Strategy Discovery
// ============================================================

async function fetchStrategies() {
  try {
    const tabId = await resolveTradingViewTabId();
    const response = await sendToContentScript(tabId, { type: 'LIST_STRATEGIES' });

    if (response.type === 'STRATEGIES_LIST') {
      sendToSidePanel({ type: 'STRATEGIES_LISTED', strategies: response.strategies });
    } else if (response.type === 'ERROR') {
      sendToSidePanel({ type: 'STRATEGIES_ERROR', error: response.error });
    }
  } catch (err) {
    sendToSidePanel({
      type: 'STRATEGIES_ERROR',
      error: toErrorMessage(err, 'Failed to list strategies'),
    });
  }
}

// ============================================================
// Parameter Detection
// ============================================================

async function detectParameters(strategyIndex: number) {
  optimizationState.status = 'detecting';
  sendStateUpdate();

  try {
    const tabId = await resolveTradingViewTabId();
    const response = await sendToContentScript(tabId, { type: 'DETECT_PARAMS', strategyIndex });

    if (response.type === 'PARAMS_DETECTED') {
      logDetectionDiagnostics('content_response', response.strategyName, response.parameters);
      sendToSidePanel({
        type: 'PARAMETERS_DETECTED',
        parameters: response.parameters,
        strategyName: response.strategyName,
      });
    } else if (response.type === 'ERROR') {
      sendToSidePanel({ type: 'DETECTION_ERROR', error: response.error });
    }
  } catch (err) {
    sendToSidePanel({
      type: 'DETECTION_ERROR',
      error: toErrorMessage(err, 'Parameter detection failed'),
    });
  } finally {
    optimizationState.status = 'idle';
    sendStateUpdate();
  }
}

// ============================================================
// Filter Evaluation
// ============================================================

function evaluateFilters(metrics: Metric[], filters: Filter[]): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const filter of filters) {
    if (!filter.enabled) continue;

    const metric = metrics.find((m) => m.name === filter.metricName && m.column === 'all');
    if (!metric) {
      failures.push(`Metric "${filter.metricName}" not found`);
      continue;
    }

    const val = metric.numericValue;
    const passed = FILTER_COMPARATORS[filter.operator](val, filter.value);

    if (!passed) {
      failures.push(`${filter.metricName} ${filter.operator} ${filter.value} (got ${val})`);
    }
  }

  return { passed: failures.length === 0, failures };
}

// ============================================================
// Study Identity / History
// ============================================================

function resolveWarmStartSourceRuns(config: OptimizationConfig, familyName: string): TrialHistoryRun[] {
  return deriveWarmStartSourceRuns(optimizationState.historyRuns, config.selectedHistoryRunIds ?? [], familyName);
}

function pruneConfigSelectedHistoryRunIds() {
  if (!optimizationState.config) return;
  const selectedIds = optimizationState.config.selectedHistoryRunIds ?? [];
  if (selectedIds.length === 0) return;

  const pruned = pruneSelectedHistoryRunIds(selectedIds, optimizationState.historyRuns);
  if (pruned.length === selectedIds.length) return;

  optimizationState.config = {
    ...optimizationState.config,
    selectedHistoryRunIds: pruned,
  };
}

function recomputeVisibleHistoryTrials() {
  optimizationState.historyTrials = deriveVisibleHistoryTrials(optimizationState.config, optimizationState.historyRuns);
}

function buildWarmStartSeedTrials(runs: TrialHistoryRun[]): WarmStartTrialSeed[] {
  return buildWarmStartSeedTrialsFromRuns(runs, MAX_WARM_START_SEEDS);
}

function syncHistoryStateAfterMutation() {
  pruneConfigSelectedHistoryRunIds();
  recomputeVisibleHistoryTrials();
  statePersistence.schedulePersist(true);
  sendStateUpdate();
}

function forceFreshRunMode(config: OptimizationConfig): OptimizationConfig {
  return {
    ...config,
    runMode: 'fresh',
    selectedHistoryRunIds: [],
  };
}

function setCurrentStudyIdentity(studyIdentity: ReturnType<typeof resolveStudyIdentity>) {
  currentStudyName = studyIdentity.studyName;
  currentStudyFamily = studyIdentity.familyName;
}

function upsertRunAndRecomputeHistory() {
  upsertCurrentRunIntoHistory();
  recomputeVisibleHistoryTrials();
}

function finalizeOptimizationRun(status: 'completed' | 'error', errorMessage?: string) {
  upsertRunAndRecomputeHistory();
  optimizationState.status = status;
  optimizationState.resumeAvailable = false;

  if (status === 'completed') {
    optimizationState.error = null;
    sendToSidePanel({ type: 'OPTIMIZATION_COMPLETE', bestTrial: optimizationState.bestTrial });
  } else {
    optimizationState.error = errorMessage ?? 'Unknown error';
    sendToSidePanel({ type: 'OPTIMIZATION_ERROR', error: optimizationState.error });
  }

  sendStateUpdate();
  statePersistence.schedulePersist(true);
}

async function clearTrialHistory(familyOnly: boolean) {
  const runSnapshot = [...optimizationState.historyRuns];
  const familiesToDelete = new Set<string>();
  if (familyOnly) {
    const config = optimizationState.config;
    const familyName = config ? resolveFamilyName(config) : null;
    if (!familyName) return;
    familiesToDelete.add(familyName);
  } else {
    for (const run of runSnapshot) {
      familiesToDelete.add(run.familyName);
    }
  }

  const deletedFamilies = new Set<string>();
  for (const familyName of familiesToDelete) {
    try {
      await sendMaintenanceCommand(BACKEND_WS_URL, MAX_BACKEND_MESSAGE_BYTES, {
        type: 'delete_study_family',
        study_family: familyName,
      });
      deletedFamilies.add(familyName);
    } catch (err) {
      console.warn('[SW] Failed to delete backend study family:', familyName, err);
    }
  }

  if (deletedFamilies.size === 0) {
    return;
  }
  optimizationState.historyRuns = optimizationState.historyRuns.filter((run) => !deletedFamilies.has(run.familyName));
  syncHistoryStateAfterMutation();
}

async function deleteHistoryRun(runId: string) {
  const targetRun = optimizationState.historyRuns.find((run) => run.id === runId);
  if (!targetRun) {
    return;
  }

  const targetStudyName = targetRun.studyName || targetRun.familyName;
  try {
    await sendMaintenanceCommand(BACKEND_WS_URL, MAX_BACKEND_MESSAGE_BYTES, {
      type: 'delete_study',
      study_name: targetStudyName,
    });
    optimizationState.historyRuns = optimizationState.historyRuns.filter((run) => run.id !== runId);
  } catch (err) {
    console.warn('[SW] Failed to delete backend study:', targetStudyName, err);
    return;
  }

  syncHistoryStateAfterMutation();
}

function upsertCurrentRunIntoHistory() {
  const config = optimizationState.config;
  if (!config || optimizationState.trials.length === 0) return;
  const familyName = currentStudyFamily ?? resolveFamilyName(config);
  if (!familyName) return;

  const startedAt = optimizationState.startTime ?? optimizationState.trials[0]?.timestamp ?? Date.now();
  const completedAt = optimizationState.trials[optimizationState.trials.length - 1]?.timestamp ?? Date.now();
  const runId = `${familyName}_${startedAt}_${completedAt}`;
  const runEntry: TrialHistoryRun = {
    id: runId,
    familyName,
    studyName: currentStudyName ?? familyName,
    strategyName: config.strategyName,
    runMode: config.runMode,
    startedAt,
    completedAt,
    trials: [...optimizationState.trials],
  };

  optimizationState.historyRuns = [runEntry, ...optimizationState.historyRuns.filter((run) => run.id !== runId)].slice(
    0,
    MAX_PERSISTED_HISTORY_RUNS,
  );
}

// ============================================================
// Optimization Loop
// ============================================================

async function startOptimization(config: OptimizationConfig) {
  const now = Date.now();
  const sanitizedCore = sanitizeOptimizationConfigInput(config);
  const normalizedConfig: OptimizationConfig = {
    id: typeof config.id === 'string' && config.id.length > 0 ? config.id : `opt_${now}`,
    ...sanitizedCore,
    createdAt: Number.isFinite(config.createdAt) ? config.createdAt : now,
    updatedAt: now,
  };

  logDebug(
    '[SW] startOptimization called with strategy:',
    normalizedConfig.strategyName,
    'trials:',
    normalizedConfig.totalTrials,
  );

  shouldStop = false;
  pauseController.reset();

  optimizationState.status = 'running';
  optimizationState.config = normalizedConfig;
  optimizationState.currentTrial = 0;
  optimizationState.trials = [];
  optimizationState.historyTrials = [];
  optimizationState.resumeAvailable = false;
  optimizationState.bestTrial = null;
  optimizationState.error = null;
  optimizationState.startTime = now;
  optimizationState.pausedAt = null;
  sendStateUpdate();

  // Start keepalive (C3)
  startKeepalive();

  // Store the active tab ID at start (H4)
  try {
    optimizationTabId = await resolveTradingViewTabId();
    logDebug('[SW] Active tab ID:', optimizationTabId);
  } catch (err) {
    console.error('[SW] Failed to get active tab ID:', err);
    optimizationState.status = 'error';
    optimizationState.error = toErrorMessage(err, 'No active tab found');
    sendToSidePanel({ type: 'OPTIMIZATION_ERROR', error: optimizationState.error });
    sendStateUpdate();
    stopKeepalive();
    return;
  }

  const backend = ensureBackendClient();

  try {
    const searchSpace = buildSearchSpace(normalizedConfig.parameters);
    logDebug('[SW] Search space built:', searchSpace.length, 'parameters');

    if (searchSpace.length === 0) {
      throw new Error('No parameters enabled for optimization. Enable at least one parameter.');
    }

    let effectiveConfig = normalizedConfig;
    const normalizedSelectedHistoryRunIds = (normalizedConfig.selectedHistoryRunIds ?? []).filter(
      (id) => typeof id === 'string' && id.length > 0,
    );
    if (normalizedConfig.runMode === 'warm_start' && normalizedSelectedHistoryRunIds.length === 0) {
      logDebug('[SW] Warm-start requested without selected history; switching to fresh mode.');
      effectiveConfig = forceFreshRunMode(effectiveConfig);
      optimizationState.config = effectiveConfig;
    }

    let studyIdentity = resolveStudyIdentity(effectiveConfig, searchSpace);
    setCurrentStudyIdentity(studyIdentity);
    let warmStartSeedTrials: WarmStartTrialSeed[] | undefined;
    if (effectiveConfig.runMode === 'warm_start') {
      const sourceRuns = resolveWarmStartSourceRuns(effectiveConfig, studyIdentity.familyName);
      if (sourceRuns.length === 0) {
        console.warn('[SW] No compatible selected runs for warm-start; switching to fresh mode.');
        effectiveConfig = forceFreshRunMode(effectiveConfig);
        optimizationState.config = effectiveConfig;
        studyIdentity = resolveStudyIdentity(effectiveConfig, searchSpace);
        setCurrentStudyIdentity(studyIdentity);
        optimizationState.historyTrials = [];
      } else {
        optimizationState.historyTrials = sourceRuns
          .flatMap((run) => run.trials)
          .sort((a, b) => a.timestamp - b.timestamp);
        warmStartSeedTrials = buildWarmStartSeedTrials(sourceRuns);
        logDebug(
          `[SW] Warm-start selected runs matched: ${sourceRuns.length}/${effectiveConfig.selectedHistoryRunIds.length}`,
        );
        logDebug(
          `[SW] Retained previous run history: ${optimizationState.historyTrials.length} trials across ${sourceRuns.length} runs`,
        );
        logDebug(`[SW] Warm-start seed payload: ${warmStartSeedTrials.length} compatible completed trials`);
      }
    } else {
      optimizationState.historyTrials = [];
    }
    optimizationState.config = effectiveConfig;
    sendStateUpdate();

    logDebug(
      '[SW] Study identity resolved:',
      `mode=${effectiveConfig.runMode}`,
      `family=${studyIdentity.familyName}`,
      `study=${studyIdentity.studyName}`,
      `sig=${studyIdentity.signature}`,
    );

    logDebug('[SW] Connecting WebSocket for study:', studyIdentity.studyName);
    await backend.connect(studyIdentity.studyName);

    const initPayloadBase: Omit<InitRequestPayload, 'warm_start_trials'> = {
      type: 'init',
      study_name: studyIdentity.studyName,
      study_family: studyIdentity.familyName,
      direction: effectiveConfig.targetMetricDirection,
      search_space: searchSpace,
      sampler: effectiveConfig.sampler,
      run_mode: effectiveConfig.runMode,
    };
    const initPayloadBudget = applyInitPayloadBudget(initPayloadBase, warmStartSeedTrials);
    if (initPayloadBudget.droppedSeeds > 0) {
      logDebug(`[SW] Init payload budget applied: dropped ${initPayloadBudget.droppedSeeds} warm-start seeds`);
    }
    logDebug(`[SW] Sending init payload (${initPayloadBudget.payloadBytes} bytes) to backend...`);

    const initAck = await backend.request(initPayloadBudget.payload, 45000);
    logDebug('[SW] Received init ack:', initAck.type);
    if (initAck.type === 'error') {
      throw new Error(initAck.message);
    }
    if (initAck.type !== 'init_ack') {
      throw new Error(`Unexpected init response type: ${initAck.type}`);
    }
    logDebug(`[SW] Study ready (${effectiveConfig.runMode}). Existing/seeded trials: ${initAck.n_existing_trials}`);

    // Start WebSocket keepalive AFTER init handshake succeeds
    startWsKeepalive();

    const tabId = optimizationTabId!;
    logDebug('[SW] Starting optimization loop (%d trials)...', effectiveConfig.totalTrials);
    let lastBestTrialNumber: number | null = null;
    const runState: {
      currentTrial: number;
      trials: OptimizationState['trials'];
      bestTrial: OptimizationState['bestTrial'];
    } = {
      currentTrial: optimizationState.currentTrial,
      trials: optimizationState.trials,
      bestTrial: optimizationState.bestTrial,
    };

    await runOptimizationTrials({
      config: effectiveConfig,
      searchSpace,
      runState,
      shouldStop: () => shouldStop,
      isPaused: () => pauseController.isPaused(),
      waitForUnpause,
      requestAsk: () => backend.request({ type: 'ask', search_space: searchSpace }, 45000),
      requestTell: (payload) => backend.request({ type: 'tell', ...payload }, 45000),
      assertOptimizationTab: () => assertOptimizationTab(tabId),
      injectParams: (params) =>
        sendToContentScript(tabId, {
          type: 'INJECT_PARAMS',
          params,
          antiDetection: effectiveConfig.antiDetection,
          strategyIndex: effectiveConfig.strategyIndex,
        }),
      scrapeResults: () => sendToContentScript(tabId, { type: 'SCRAPE_RESULTS' }),
      evaluateFilters,
      onTrialProgress: (currentTrial) => {
        optimizationState.currentTrial = currentTrial;
        sendStatePatch({ currentTrial });
      },
      onTrialRecorded: (trial) => {
        optimizationState.bestTrial = runState.bestTrial;
        sendToSidePanel({ type: 'TRIAL_COMPLETE', trial });
        const nextBestTrialNumber = runState.bestTrial?.trialNumber ?? null;
        if (nextBestTrialNumber !== lastBestTrialNumber) {
          lastBestTrialNumber = nextBestTrialNumber;
          sendStatePatch({ bestTrial: optimizationState.bestTrial });
        }
      },
      onStatePersist: () => statePersistence.schedulePersist(),
      randomDelay,
      logDebug,
    });
    optimizationState.currentTrial = runState.currentTrial;
    optimizationState.bestTrial = runState.bestTrial;

    finalizeOptimizationRun('completed');
  } catch (err) {
    console.error('[SW] Optimization error:', err);
    finalizeOptimizationRun('error', toErrorMessage(err, 'Unknown error'));
  } finally {
    logDebug('[SW] Optimization loop ended. Status:', optimizationState.status);
    currentStudyName = null;
    currentStudyFamily = null;
    backend.close();
    backendClient = null;
    optimizationTabId = null;
    stopKeepalive();

    // Re-check backend health so the UI doesn't show "offline" after WS closes
    await checkBackendHealth();
  }
}

// ============================================================
// Apply Best Parameters (C1: fix response type check)
// ============================================================

async function applyParams(params: TrialParams) {
  try {
    const tabId = optimizationTabId ?? (await resolveTradingViewTabId());
    await assertOptimizationTab(tabId);
    const config = optimizationState.config;
    const antiDetection = config?.antiDetection ?? DEFAULT_ANTI_DETECTION;

    const response = await sendToContentScript(tabId, {
      type: 'INJECT_PARAMS',
      params,
      antiDetection,
      strategyIndex: config?.strategyIndex ?? 0,
    });

    const result =
      response.type === 'PARAMS_INJECTED'
        ? { success: response.success, error: response.error }
        : response.type === 'ERROR'
          ? { success: false, error: response.error }
          : { success: false, error: 'Unexpected response from content script' };
    sendToSidePanel({ type: 'PARAMS_APPLIED', ...result });
  } catch (err) {
    sendToSidePanel({
      type: 'PARAMS_APPLIED',
      success: false,
      error: toErrorMessage(err, 'Failed to apply parameters'),
    });
  }
}

logDebug('[SW] Strategy Optimizer service worker initialized');
