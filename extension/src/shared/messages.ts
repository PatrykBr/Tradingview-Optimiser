import type {
  StrategyParameter,
  StrategyInfo,
  Metric,
  TrialParams,
  TrialResult,
  AntiDetectionConfig,
  OptimizationConfig,
  SamplerChoice,
  RunMode,
} from './types';

// ============================================================
// Side Panel <-> Service Worker Messages
// ============================================================

export type SidePanelMessage =
  | { type: 'START_OPTIMIZATION'; config: OptimizationConfig }
  | { type: 'PAUSE_OPTIMIZATION' }
  | { type: 'RESUME_OPTIMIZATION' }
  | { type: 'STOP_OPTIMIZATION' }
  | { type: 'CLEAR_TRIAL_HISTORY'; familyOnly?: boolean }
  | { type: 'DELETE_HISTORY_RUN'; runId: string }
  | { type: 'APPLY_BEST_PARAMS'; params: TrialParams }
  | { type: 'LIST_STRATEGIES' }
  | { type: 'DETECT_PARAMETERS'; strategyIndex: number }
  | { type: 'GET_STATE' }
  | { type: 'CHECK_BACKEND' };

export type ServiceWorkerMessage =
  | { type: 'STATE_UPDATE'; state: import('./types').OptimizationState }
  | { type: 'STATE_PATCH'; patch: Partial<import('./types').OptimizationState> }
  | { type: 'STRATEGIES_LISTED'; strategies: StrategyInfo[] }
  | { type: 'STRATEGIES_ERROR'; error: string }
  | { type: 'PARAMETERS_DETECTED'; parameters: StrategyParameter[]; strategyName: string }
  | { type: 'DETECTION_ERROR'; error: string }
  | { type: 'TRIAL_COMPLETE'; trial: TrialResult }
  | { type: 'OPTIMIZATION_COMPLETE'; bestTrial: TrialResult | null }
  | { type: 'OPTIMIZATION_ERROR'; error: string }
  | { type: 'BACKEND_STATUS'; status: import('./types').BackendStatus }
  | { type: 'PARAMS_APPLIED'; success: boolean; error?: string };

// ============================================================
// Service Worker <-> Content Script Messages
// ============================================================

export type ContentScriptCommand =
  | { type: 'LIST_STRATEGIES' }
  | { type: 'DETECT_PARAMS'; strategyIndex: number }
  | { type: 'INJECT_PARAMS'; params: TrialParams; antiDetection: AntiDetectionConfig; strategyIndex: number }
  | { type: 'SCRAPE_RESULTS' }
  | { type: 'PING' };

export type ContentScriptResponse =
  | { type: 'STRATEGIES_LIST'; strategies: StrategyInfo[] }
  | { type: 'PARAMS_DETECTED'; parameters: StrategyParameter[]; strategyName: string }
  | { type: 'PARAMS_INJECTED'; success: boolean; error?: string }
  | { type: 'RESULTS_SCRAPED'; metrics: Metric[]; success: boolean; error?: string }
  | { type: 'PONG' }
  | { type: 'ERROR'; error: string };

// ============================================================
// Extension <-> Python Backend WebSocket Messages
// ============================================================

export interface SearchSpaceParam {
  name: string;
  type: 'float' | 'int' | 'categorical';
  low?: number;
  high?: number;
  step?: number;
  log?: boolean;
  choices?: (string | number | boolean)[];
}

export interface WarmStartTrialSeed {
  params: Record<string, number | string | boolean>;
  value: number;
}

export type BackendOutgoingMessage =
  | {
      request_id: string;
      type: 'init';
      study_name: string;
      direction: 'minimize' | 'maximize';
      search_space: SearchSpaceParam[];
      sampler?: SamplerChoice;
      run_mode?: RunMode;
      study_family?: string;
      warm_start_trials?: WarmStartTrialSeed[];
    }
  | {
      request_id: string;
      type: 'ask';
      search_space: SearchSpaceParam[];
    }
  | {
      request_id: string;
      type: 'tell';
      trial_number: number;
      value?: number;
      state: 'complete' | 'pruned' | 'fail';
    }
  | { request_id: string; type: 'status' }
  | { request_id: string; type: 'delete_study'; study_name: string }
  | { request_id: string; type: 'delete_study_family'; study_family: string };

export type BackendIncomingMessage =
  | {
      request_id: string;
      type: 'init_ack';
      study_name: string;
      n_existing_trials: number;
    }
  | {
      request_id: string;
      type: 'delete_ack';
      deleted: 'study' | 'study_family';
      target: string;
    }
  | {
      request_id: string;
      type: 'trial';
      trial_number: number;
      params: Record<string, number | string | boolean>;
      sampler?: string | null;
    }
  | {
      request_id: string;
      type: 'tell_ack';
      trial_number: number;
      best_value: number | null;
      best_params: Record<string, number | string | boolean> | null;
      n_complete: number;
    }
  | {
      request_id: string;
      type: 'status';
      n_trials: number;
      best_value: number | null;
      best_params: Record<string, number | string | boolean> | null;
    }
  | {
      request_id?: string;
      type: 'error';
      message: string;
    };
