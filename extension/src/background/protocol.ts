import type { BackendIncomingMessage, SidePanelMessage } from '../shared/messages';
import type { OptimizationConfig } from '../shared/types';
import { sanitizeOptimizationConfigInput, sanitizeTrialParamsInput } from '../shared/config-schema';

type ParsedMessage = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRequiredRequestId(parsed: ParsedMessage): string {
  const requestId = parsed.request_id;
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Missing request_id in backend response');
  }
  return requestId;
}

function parseBackendEnvelope(raw: string, maxBytes: number): ParsedMessage {
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new Error('Backend response too large');
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Invalid backend response shape');
  }

  return parsed as ParsedMessage;
}

function parseNullableBestValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseNullableBestParams(
  value: unknown,
  errorMessage: string,
): Record<string, number | string | boolean> | null {
  const bestParams = value === null ? null : sanitizeTrialParamsInput(value);
  if (value !== null && !bestParams) {
    throw new TypeError(errorMessage);
  }
  return bestParams;
}

function parseInitAckMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'init_ack' }> {
  if (typeof parsed.study_name !== 'string' || typeof parsed.n_existing_trials !== 'number') {
    throw new TypeError('Invalid init_ack payload');
  }

  return {
    request_id: parseRequiredRequestId(parsed),
    type: 'init_ack',
    study_name: parsed.study_name,
    n_existing_trials: Math.max(0, Math.floor(parsed.n_existing_trials)),
  };
}

function parseDeleteAckMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'delete_ack' }> {
  if (
    (parsed.deleted !== 'study' && parsed.deleted !== 'study_family') ||
    typeof parsed.target !== 'string' ||
    parsed.target.length === 0
  ) {
    throw new Error('Invalid delete_ack payload');
  }

  return {
    request_id: parseRequiredRequestId(parsed),
    type: 'delete_ack',
    deleted: parsed.deleted,
    target: parsed.target,
  };
}

function parseTrialMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'trial' }> {
  if (typeof parsed.trial_number !== 'number' || !isRecord(parsed.params)) {
    throw new Error('Invalid trial payload');
  }

  const params = sanitizeTrialParamsInput(parsed.params);
  if (!params) {
    throw new Error('Invalid trial params');
  }

  return {
    request_id: parseRequiredRequestId(parsed),
    type: 'trial',
    trial_number: Math.max(0, Math.floor(parsed.trial_number)),
    params,
    sampler: typeof parsed.sampler === 'string' || parsed.sampler === null ? parsed.sampler : undefined,
  };
}

function parseTellAckMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'tell_ack' }> {
  if (typeof parsed.trial_number !== 'number' || typeof parsed.n_complete !== 'number') {
    throw new TypeError('Invalid tell_ack payload');
  }

  return {
    request_id: parseRequiredRequestId(parsed),
    type: 'tell_ack',
    trial_number: Math.max(0, Math.floor(parsed.trial_number)),
    best_value: parseNullableBestValue(parsed.best_value),
    best_params: parseNullableBestParams(parsed.best_params, 'Invalid tell_ack best_params'),
    n_complete: Math.max(0, Math.floor(parsed.n_complete)),
  };
}

function parseStatusMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'status' }> {
  if (typeof parsed.n_trials !== 'number') {
    throw new TypeError('Invalid status payload');
  }

  return {
    request_id: parseRequiredRequestId(parsed),
    type: 'status',
    n_trials: Math.max(0, Math.floor(parsed.n_trials)),
    best_value: parseNullableBestValue(parsed.best_value),
    best_params: parseNullableBestParams(parsed.best_params, 'Invalid status best_params'),
  };
}

function parseErrorMessage(parsed: ParsedMessage): Extract<BackendIncomingMessage, { type: 'error' }> {
  return {
    type: 'error',
    request_id: typeof parsed.request_id === 'string' && parsed.request_id.length > 0 ? parsed.request_id : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : 'Backend error',
  };
}

const BACKEND_MESSAGE_PARSERS = {
  init_ack: parseInitAckMessage,
  delete_ack: parseDeleteAckMessage,
  trial: parseTrialMessage,
  tell_ack: parseTellAckMessage,
  status: parseStatusMessage,
  error: parseErrorMessage,
} satisfies Record<BackendIncomingMessage['type'], (parsed: ParsedMessage) => BackendIncomingMessage>;

function parseDetectParametersMessage(raw: Record<string, unknown>): SidePanelMessage | null {
  const strategyIndex = typeof raw.strategyIndex === 'number' ? Math.floor(raw.strategyIndex) : -1;
  if (strategyIndex < 0) {
    return null;
  }

  return { type: 'DETECT_PARAMETERS', strategyIndex };
}

function parseStartOptimizationMessage(raw: Record<string, unknown>): SidePanelMessage | null {
  const configValue = raw.config;
  if (!isRecord(configValue)) {
    return null;
  }

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

function parseClearTrialHistoryMessage(raw: Record<string, unknown>): SidePanelMessage {
  return {
    type: 'CLEAR_TRIAL_HISTORY',
    familyOnly: Boolean(raw.familyOnly),
  };
}

function parseDeleteHistoryRunMessage(raw: Record<string, unknown>): SidePanelMessage | null {
  if (typeof raw.runId !== 'string' || raw.runId.length === 0) {
    return null;
  }

  return {
    type: 'DELETE_HISTORY_RUN',
    runId: raw.runId.slice(0, 120),
  };
}

function parseApplyBestParamsMessage(raw: Record<string, unknown>): SidePanelMessage | null {
  const params = sanitizeTrialParamsInput(raw.params);
  if (!params) {
    return null;
  }

  return { type: 'APPLY_BEST_PARAMS', params };
}

const SIMPLE_SIDE_PANEL_MESSAGE_FACTORIES = {
  CHECK_BACKEND: (): SidePanelMessage => ({ type: 'CHECK_BACKEND' }),
  LIST_STRATEGIES: (): SidePanelMessage => ({ type: 'LIST_STRATEGIES' }),
  PAUSE_OPTIMIZATION: (): SidePanelMessage => ({ type: 'PAUSE_OPTIMIZATION' }),
  RESUME_OPTIMIZATION: (): SidePanelMessage => ({ type: 'RESUME_OPTIMIZATION' }),
  STOP_OPTIMIZATION: (): SidePanelMessage => ({ type: 'STOP_OPTIMIZATION' }),
  GET_STATE: (): SidePanelMessage => ({ type: 'GET_STATE' }),
} as const;

const SIDE_PANEL_MESSAGE_PARSERS = {
  DETECT_PARAMETERS: parseDetectParametersMessage,
  START_OPTIMIZATION: parseStartOptimizationMessage,
  CLEAR_TRIAL_HISTORY: parseClearTrialHistoryMessage,
  DELETE_HISTORY_RUN: parseDeleteHistoryRunMessage,
  APPLY_BEST_PARAMS: parseApplyBestParamsMessage,
} satisfies Record<string, (raw: Record<string, unknown>) => SidePanelMessage | null>;

export function parseBackendIncomingMessage(raw: string, maxBytes: number): BackendIncomingMessage {
  const parsed = parseBackendEnvelope(raw, maxBytes);
  const parser = BACKEND_MESSAGE_PARSERS[parsed.type as BackendIncomingMessage['type']];
  if (!parser) {
    throw new Error('Unknown backend message type');
  }
  return parser(parsed);
}

export function parseSidePanelMessage(raw: unknown): SidePanelMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return null;
  }

  const simpleFactory = SIMPLE_SIDE_PANEL_MESSAGE_FACTORIES[raw.type as keyof typeof SIMPLE_SIDE_PANEL_MESSAGE_FACTORIES];
  if (simpleFactory) {
    return simpleFactory();
  }

  const parser = SIDE_PANEL_MESSAGE_PARSERS[raw.type as keyof typeof SIDE_PANEL_MESSAGE_PARSERS];
  return parser ? parser(raw) : null;
}
