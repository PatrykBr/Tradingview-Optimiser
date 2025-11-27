import type { TrialBroadcast, TrialResult } from "./ipc";

export function broadcastToTrial(payload: TrialBroadcast): TrialResult {
  return {
    id: `trial-${payload.trial}-${Date.now()}`,
    trial: payload.trial,
    params: payload.params,
    metrics: payload.metrics,
    passedFilters: payload.passedFilters,
    filterReasons: payload.filterReasons,
    timestamp: new Date().toISOString(),
  };
}

