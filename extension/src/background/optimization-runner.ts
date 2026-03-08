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

export async function runOptimizationTrials(options: RunOptimizationTrialsOptions): Promise<void> {
  const {
    config,
    runState,
    shouldStop,
    isPaused,
    waitForUnpause,
    requestAsk,
    requestTell,
    assertOptimizationTab,
    injectParams,
    scrapeResults,
    evaluateFilters,
    onTrialProgress,
    onTrialRecorded,
    onStatePersist,
    randomDelay,
    logDebug,
  } = options;

  const requestTellOrThrow = async (payload: {
    trial_number: number;
    value?: number;
    state: 'complete' | 'pruned' | 'fail';
  }): Promise<BackendIncomingMessage> => {
    const response = await requestTell(payload);
    if (response.type === 'error') {
      throw new Error(response.message);
    }
    return response;
  };

  const markTrialFailed = async (trialNumber: number): Promise<void> => {
    await requestTellOrThrow({
      trial_number: trialNumber,
      state: 'fail',
    });
  };

  const persistRecordedTrial = (trial: TrialResult): void => {
    onTrialRecorded(trial);
    onStatePersist();
  };

  for (let i = 0; i < config.totalTrials; i++) {
    if (shouldStop()) break;

    if (isPaused()) {
      try {
        await waitForUnpause();
      } catch {
        break;
      }
    }
    if (shouldStop()) break;

    const trialStart = Date.now();
    runState.currentTrial = i + 1;
    onTrialProgress(runState.currentTrial);

    const trialMsg = await requestAsk();
    if (trialMsg.type === 'error') {
      throw new Error(trialMsg.message);
    }
    if (trialMsg.type !== 'trial') {
      throw new Error(`Unexpected message type: ${trialMsg.type}`);
    }

    logDebug(`[Runner] Trial ${trialMsg.trial_number} sampler: ${trialMsg.sampler ?? 'AutoSampler'}`);

    const suggestedParams = trialMsg.params;
    await assertOptimizationTab();

    const injectResponse = await injectParams(suggestedParams as TrialParams);
    if (injectResponse.type !== 'PARAMS_INJECTED') {
      await markTrialFailed(trialMsg.trial_number);
      continue;
    }
    if (!injectResponse.success || injectResponse.error) {
      if (injectResponse.error) {
        logDebug(`[Runner] Trial ${trialMsg.trial_number} injection warning: ${injectResponse.error}`);
      }
      await markTrialFailed(trialMsg.trial_number);
      continue;
    }

    await assertOptimizationTab();
    const scrapeResponse = await scrapeResults();
    if (scrapeResponse.type !== 'RESULTS_SCRAPED' || !scrapeResponse.success) {
      await markTrialFailed(trialMsg.trial_number);
      continue;
    }

    const metrics = scrapeResponse.metrics;
    const { passed, failures } = evaluateFilters(metrics, config.filters);
    const targetMetric = metrics.find(
      (metric) => metric.name === config.targetMetric && metric.column === (config.targetMetricColumn || 'all'),
    );

    if (!targetMetric) {
      await markTrialFailed(trialMsg.trial_number);
      const failTrial: TrialResult = {
        trialNumber: trialMsg.trial_number,
        params: suggestedParams as TrialParams,
        metrics,
        objectiveValue: 0,
        passedFilters: false,
        filterFailures: [`Target metric "${config.targetMetric}" not found`],
        timestamp: Date.now(),
        duration: Date.now() - trialStart,
      };
      runState.trials.push(failTrial);
      persistRecordedTrial(failTrial);
      continue;
    }

    const objectiveValue = targetMetric.numericValue;
    const tellAck = await requestTellOrThrow({
      trial_number: trialMsg.trial_number,
      value: passed ? objectiveValue : undefined,
      state: passed ? 'complete' : 'fail',
    });

    const trial: TrialResult = {
      trialNumber: trialMsg.trial_number,
      params: suggestedParams as TrialParams,
      metrics,
      objectiveValue,
      passedFilters: passed,
      filterFailures: failures,
      timestamp: Date.now(),
      duration: Date.now() - trialStart,
    };
    runState.trials.push(trial);

    if (passed && tellAck.type === 'tell_ack' && tellAck.best_value !== null) {
      if (
        !runState.bestTrial ||
        (config.targetMetricDirection === 'maximize' && objectiveValue > runState.bestTrial.objectiveValue) ||
        (config.targetMetricDirection === 'minimize' && objectiveValue < runState.bestTrial.objectiveValue)
      ) {
        runState.bestTrial = trial;
      }
    }
    persistRecordedTrial(trial);

    if (config.antiDetection.enabled && i < config.totalTrials - 1) {
      await randomDelay(config.antiDetection);
    }
  }
}
