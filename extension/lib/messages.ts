import type { NextTrial, RunProgress } from './protocol/types';
import type { DetectedStrategy, StrategyInput } from './tradingview/types';

export type BackgroundMessage =
  | { type: 'TOGGLE_UI' }
  | { type: 'BACKEND_STATE'; connected: boolean; optunaVersion?: string }
  | { type: 'RUN_PROGRESS'; progress: RunProgress }
  | { type: 'NEXT_TRIAL'; trial: NextTrial }
  | { type: 'BACKEND_ERROR'; message: string };

export type ContentRequest =
  | { type: 'PROBE_STRATEGIES' }
  | { type: 'READ_INPUTS'; strategyName: string };

export type ContentResponse =
  | { ok: true; strategies: DetectedStrategy[] }
  | { ok: true; inputs: StrategyInput[] }
  | { ok: false; error: string };
