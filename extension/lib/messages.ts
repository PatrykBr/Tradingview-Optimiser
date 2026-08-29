import type { CreateRun, NextTrial, RunProgress, TrialResult } from './protocol/types';

export interface BackendState {
  connected: boolean;
  optunaVersion?: string;
}

export type BackgroundMessage =
  | { type: 'TOGGLE_UI' }
  | ({ type: 'BACKEND_STATE' } & BackendState)
  | { type: 'RUN_PROGRESS'; progress: RunProgress }
  | { type: 'NEXT_TRIAL'; trial: NextTrial }
  | { type: 'BACKEND_ERROR'; message: string };

export type ExtensionRequest =
  | { type: 'GET_BACKEND_STATE' }
  | { type: 'BACKEND_CONNECT' }
  | { type: 'CREATE_RUN'; payload: CreateRun }
  | { type: 'START_RUN'; payload: { runId: string } }
  | { type: 'STOP_RUN'; payload: { runId: string } }
  | { type: 'TRIAL_RESULT'; payload: TrialResult }
  | {
      type: 'TRIAL_FAILED';
      payload: { runId: string; trialNumber: number; reason: string };
    };
