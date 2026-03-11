import type { BackendIncomingMessage, ContentScriptResponse, SearchSpaceParam } from '../shared/messages';
import type { Metric, OptimizationConfig, TrialParams, TrialResult } from '../shared/types';

export interface OptimizationRunState {
  currentTrial: number;
  trials: TrialResult[];
  bestTrial: TrialResult | null;
}

export interface RunOptimizationTrialsOptions {
  config: OptimizationConfig;
  searchSpace: SearchSpaceParam[];
  runState: OptimizationRunState;
  shouldStop: () => boolean;
  isPaused: () => boolean;
  waitForUnpause: () => Promise<void>;
  requestAsk: () => Promise<BackendIncomingMessage>;
  requestTell: (payload: {
    trial_number: number;
    value?: number;
    state: 'complete' | 'pruned' | 'fail';
  }) => Promise<BackendIncomingMessage>;
  assertOptimizationTab: () => Promise<void>;
  injectParams: (params: TrialParams) => Promise<ContentScriptResponse>;
  scrapeResults: () => Promise<ContentScriptResponse>;
  evaluateFilters: (
    metrics: Metric[],
    filters: OptimizationConfig['filters'],
  ) => { passed: boolean; failures: string[] };
  onTrialProgress: (currentTrial: number) => void;
  onTrialRecorded: (trial: TrialResult) => void;
  onStatePersist: () => void;
  randomDelay: (config: OptimizationConfig['antiDetection']) => Promise<void>;
  logDebug: (...args: unknown[]) => void;
}

type TellPayload = Parameters<RunOptimizationTrialsOptions['requestTell']>[0];
type TrialMessage = Extract<BackendIncomingMessage, { type: 'trial' }>;

interface TrialExecutionResult {
  trial: TrialResult;
  tellAck: BackendIncomingMessage | null;
  delayBeforeNextTrial: boolean;
}

async function requestTellOrThrow(
  requestTell: RunOptimizationTrialsOptions['requestTell'],
  payload: TellPayload,
): Promise<BackendIncomingMessage> {
  const response = await requestTell(payload);
  if (response.type === 'error') {
    throw new Error(response.message);
  }
  return response;
}

async function waitForRunnableState(
  shouldStop: RunOptimizationTrialsOptions['shouldStop'],
  isPaused: RunOptimizationTrialsOptions['isPaused'],
  waitForUnpause: RunOptimizationTrialsOptions['waitForUnpause'],
): Promise<boolean> {
  if (shouldStop()) {
    return false;
  }
  if (!isPaused()) {
    return true;
  }

  try {
    await waitForUnpause();
  } catch {
    return false;
  }

  return !shouldStop();
}

async function requestTrialSuggestion(
  requestAsk: RunOptimizationTrialsOptions['requestAsk'],
): Promise<TrialMessage> {
  const trialMessage = await requestAsk();
  if (trialMessage.type === 'error') {
    throw new Error(trialMessage.message);
  }
  if (trialMessage.type !== 'trial') {
    throw new Error(`Unexpected message type: ${trialMessage.type}`);
  }
  return trialMessage;
}

async function markTrialFailed(
  requestTell: RunOptimizationTrialsOptions['requestTell'],
  trialNumber: number,
): Promise<void> {
  await requestTellOrThrow(requestTell, {
    trial_number: trialNumber,
    state: 'fail',
  });
}

async function injectSuggestedParams(
  options: Pick<RunOptimizationTrialsOptions, 'assertOptimizationTab' | 'injectParams' | 'logDebug' | 'requestTell'>,
  trialNumber: number,
  suggestedParams: TrialParams,
): Promise<boolean> {
  await options.assertOptimizationTab();
  const injectResponse = await options.injectParams(suggestedParams);
  if (injectResponse.type !== 'PARAMS_INJECTED') {
    await markTrialFailed(options.requestTell, trialNumber);
    return false;
  }
  if (!injectResponse.success || injectResponse.error) {
    if (injectResponse.error) {
      options.logDebug(`[Runner] Trial ${trialNumber} injection warning: ${injectResponse.error}`);
    }
    await markTrialFailed(options.requestTell, trialNumber);
    return false;
  }
  return true;
}

async function scrapeTrialMetrics(
  options: Pick<RunOptimizationTrialsOptions, 'assertOptimizationTab' | 'scrapeResults' | 'requestTell'>,
  trialNumber: number,
): Promise<Metric[] | null> {
  await options.assertOptimizationTab();
  const scrapeResponse = await options.scrapeResults();
  if (scrapeResponse.type === 'RESULTS_SCRAPED' && scrapeResponse.success) {
    return scrapeResponse.metrics;
  }
  await markTrialFailed(options.requestTell, trialNumber);
  return null;
}

function buildMissingTargetMetricTrial(
  config: OptimizationConfig,
  trialMessage: TrialMessage,
  suggestedParams: TrialParams,
  metrics: Metric[],
  trialStart: number,
): TrialResult {
  return {
    trialNumber: trialMessage.trial_number,
    params: suggestedParams,
    metrics,
    objectiveValue: 0,
    passedFilters: false,
    filterFailures: [`Target metric "${config.targetMetric}" not found`],
    timestamp: Date.now(),
    duration: Date.now() - trialStart,
  };
}

function buildRecordedTrial(
  trialMessage: TrialMessage,
  suggestedParams: TrialParams,
  metrics: Metric[],
  objectiveValue: number,
  passedFilters: boolean,
  filterFailures: string[],
  trialStart: number,
): TrialResult {
  return {
    trialNumber: trialMessage.trial_number,
    params: suggestedParams,
    metrics,
    objectiveValue,
    passedFilters,
    filterFailures,
    timestamp: Date.now(),
    duration: Date.now() - trialStart,
  };
}

function isBetterObjective(
  config: OptimizationConfig,
  objectiveValue: number,
  bestTrial: TrialResult | null,
): boolean {
  if (!bestTrial) {
    return true;
  }
  return config.targetMetricDirection === 'maximize'
    ? objectiveValue > bestTrial.objectiveValue
    : objectiveValue < bestTrial.objectiveValue;
}

function recordTrialOutcome(
  options: Pick<RunOptimizationTrialsOptions, 'config' | 'runState' | 'onTrialRecorded' | 'onStatePersist'>,
  result: TrialExecutionResult,
): void {
  options.runState.trials.push(result.trial);
  if (
    result.trial.passedFilters &&
    result.tellAck?.type === 'tell_ack' &&
    result.tellAck.best_value !== null &&
    isBetterObjective(options.config, result.trial.objectiveValue, options.runState.bestTrial)
  ) {
    options.runState.bestTrial = result.trial;
  }
  options.onTrialRecorded(result.trial);
  options.onStatePersist();
}

async function executeTrial(
  options: Pick<
    RunOptimizationTrialsOptions,
    'config' | 'assertOptimizationTab' | 'injectParams' | 'scrapeResults' | 'evaluateFilters' | 'requestTell' | 'logDebug'
  >,
  trialMessage: TrialMessage,
  trialStart: number,
): Promise<TrialExecutionResult | null> {
  options.logDebug(`[Runner] Trial ${trialMessage.trial_number} sampler: ${trialMessage.sampler ?? 'AutoSampler'}`);

  const suggestedParams = trialMessage.params as TrialParams;
  const injected = await injectSuggestedParams(options, trialMessage.trial_number, suggestedParams);
  if (!injected) {
    return null;
  }

  const metrics = await scrapeTrialMetrics(options, trialMessage.trial_number);
  if (!metrics) {
    return null;
  }

  const targetMetric = metrics.find(
    (metric) => metric.name === options.config.targetMetric && metric.column === (options.config.targetMetricColumn || 'all'),
  );
  if (!targetMetric) {
    await markTrialFailed(options.requestTell, trialMessage.trial_number);
    return {
      trial: buildMissingTargetMetricTrial(options.config, trialMessage, suggestedParams, metrics, trialStart),
      tellAck: null,
      delayBeforeNextTrial: false,
    };
  }

  const { passed, failures } = options.evaluateFilters(metrics, options.config.filters);
  const objectiveValue = targetMetric.numericValue;
  const tellAck = await requestTellOrThrow(options.requestTell, {
    trial_number: trialMessage.trial_number,
    value: passed ? objectiveValue : undefined,
    state: passed ? 'complete' : 'fail',
  });

  return {
    trial: buildRecordedTrial(
      trialMessage,
      suggestedParams,
      metrics,
      objectiveValue,
      passed,
      failures,
      trialStart,
    ),
    tellAck,
    delayBeforeNextTrial: true,
  };
}

export async function runOptimizationTrials(options: RunOptimizationTrialsOptions): Promise<void> {
  const {
    config,
    runState,
    shouldStop,
    isPaused,
    waitForUnpause,
    requestAsk,
    onTrialProgress,
    randomDelay,
  } = options;

  for (let i = 0; i < config.totalTrials; i++) {
    if (!(await waitForRunnableState(shouldStop, isPaused, waitForUnpause))) {
      break;
    }

    const trialStart = Date.now();
    runState.currentTrial = i + 1;
    onTrialProgress(runState.currentTrial);

    const trialMessage = await requestTrialSuggestion(requestAsk);
    const result = await executeTrial(options, trialMessage, trialStart);
    if (!result) {
      continue;
    }

    recordTrialOutcome(options, result);

    if (result.delayBeforeNextTrial && config.antiDetection.enabled && i < config.totalTrials - 1) {
      await randomDelay(config.antiDetection);
    }
  }
}
