import type { BackendIncomingMessage, SidePanelMessage } from '../shared/messages';
import type { OptimizationConfig } from '../shared/types';
import { sanitizeOptimizationConfigInput, sanitizeTrialParamsInput } from '../shared/config-schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRequiredRequestId(parsed: Record<string, unknown>): string {
  const requestId = parsed.request_id;
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Missing request_id in backend response');
  }
  return requestId;
}

export function parseBackendIncomingMessage(raw: string, maxBytes: number): BackendIncomingMessage {
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new Error('Backend response too large');
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Invalid backend response shape');
  }

  if (parsed.type === 'init_ack') {
    if (typeof parsed.study_name !== 'string' || typeof parsed.n_existing_trials !== 'number') {
      throw new Error('Invalid init_ack payload');
    }
    return {
      request_id: parseRequiredRequestId(parsed),
      type: 'init_ack',
      study_name: parsed.study_name,
      n_existing_trials: Math.max(0, Math.floor(parsed.n_existing_trials)),
    };
  }

  if (parsed.type === 'trial') {
    if (typeof parsed.trial_number !== 'number' || !isRecord(parsed.params)) {
      throw new Error('Invalid trial payload');
    }
    const params = sanitizeTrialParamsInput(parsed.params);
    if (!params) throw new Error('Invalid trial params');
    return {
      request_id: parseRequiredRequestId(parsed),
      type: 'trial',
      trial_number: Math.max(0, Math.floor(parsed.trial_number)),
      params,
      sampler: typeof parsed.sampler === 'string' || parsed.sampler === null ? parsed.sampler : undefined,
    };
  }

  if (parsed.type === 'tell_ack') {
    if (typeof parsed.trial_number !== 'number' || typeof parsed.n_complete !== 'number') {
      throw new Error('Invalid tell_ack payload');
    }
    const bestParams = parsed.best_params === null ? null : sanitizeTrialParamsInput(parsed.best_params);
    if (parsed.best_params !== null && !bestParams) {
      throw new Error('Invalid tell_ack best_params');
    }
    return {
      request_id: parseRequiredRequestId(parsed),
      type: 'tell_ack',
      trial_number: Math.max(0, Math.floor(parsed.trial_number)),
      best_value:
        typeof parsed.best_value === 'number' && Number.isFinite(parsed.best_value) ? parsed.best_value : null,
      best_params: bestParams,
      n_complete: Math.max(0, Math.floor(parsed.n_complete)),
    };
  }

  if (parsed.type === 'status') {
    if (typeof parsed.n_trials !== 'number') {
      throw new Error('Invalid status payload');
    }
    const bestParams = parsed.best_params === null ? null : sanitizeTrialParamsInput(parsed.best_params);
    if (parsed.best_params !== null && !bestParams) {
      throw new Error('Invalid status best_params');
    }
    return {
      request_id: parseRequiredRequestId(parsed),
      type: 'status',
      n_trials: Math.max(0, Math.floor(parsed.n_trials)),
      best_value:
        typeof parsed.best_value === 'number' && Number.isFinite(parsed.best_value) ? parsed.best_value : null,
      best_params: bestParams,
    };
  }

  if (parsed.type === 'error') {
    return {
      type: 'error',
      request_id: typeof parsed.request_id === 'string' && parsed.request_id.length > 0 ? parsed.request_id : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : 'Backend error',
    };
  }

  throw new Error('Unknown backend message type');
}

export function parseSidePanelMessage(raw: unknown): SidePanelMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  if (raw.type === 'CHECK_BACKEND') return { type: 'CHECK_BACKEND' };
  if (raw.type === 'LIST_STRATEGIES') return { type: 'LIST_STRATEGIES' };
  if (raw.type === 'PAUSE_OPTIMIZATION') return { type: 'PAUSE_OPTIMIZATION' };
  if (raw.type === 'RESUME_OPTIMIZATION') return { type: 'RESUME_OPTIMIZATION' };
  if (raw.type === 'STOP_OPTIMIZATION') return { type: 'STOP_OPTIMIZATION' };
  if (raw.type === 'GET_STATE') return { type: 'GET_STATE' };

  if (raw.type === 'DETECT_PARAMETERS') {
    const strategyIndex = typeof raw.strategyIndex === 'number' ? Math.floor(raw.strategyIndex) : -1;
    if (strategyIndex < 0) return null;
    return { type: 'DETECT_PARAMETERS', strategyIndex };
  }

  if (raw.type === 'START_OPTIMIZATION') {
    const configValue = raw.config;
    if (!isRecord(configValue)) return null;
    const now = Date.now();
    const sanitizedCore = sanitizeOptimizationConfigInput(configValue);
    const createdAtRaw = typeof configValue.createdAt === 'number' ? configValue.createdAt : now;
    const config: OptimizationConfig = {
      id: typeof configValue.id === 'string' && configValue.id.length > 0 ? configValue.id : `opt_${now}`,
      ...sanitizedCore,
      createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : now,
      updatedAt: now,
    };
    return { type: 'START_OPTIMIZATION', config };
  }

  if (raw.type === 'CLEAR_TRIAL_HISTORY') {
    return {
      type: 'CLEAR_TRIAL_HISTORY',
      familyOnly: Boolean(raw.familyOnly),
    };
  }

  if (raw.type === 'DELETE_HISTORY_RUN') {
    if (typeof raw.runId !== 'string' || raw.runId.length === 0) return null;
    return { type: 'DELETE_HISTORY_RUN', runId: raw.runId.slice(0, 120) };
  }

  if (raw.type === 'APPLY_BEST_PARAMS') {
    const params = sanitizeTrialParamsInput(raw.params);
    if (!params) return null;
    return { type: 'APPLY_BEST_PARAMS', params };
  }

  return null;
}
