import type {
  AntiDetectionConfig,
  Filter,
  FilterOperator,
  OptimizationConfig,
  RunMode,
  SamplerChoice,
  SavedConfig,
  StrategyParameter,
  TrialParams,
} from './types';
import { normalizeNumericRange } from './parameter-normalization';

type TargetMetricDirection = OptimizationConfig['targetMetricDirection'];
type TargetMetricColumn = OptimizationConfig['targetMetricColumn'];

const RUN_MODES = new Set<RunMode>(['resume', 'fresh', 'warm_start']);
const SAMPLERS = new Set<SamplerChoice>(['auto', 'tpe', 'random', 'gp', 'qmc', 'cmaes']);
const TARGET_DIRECTIONS = new Set<TargetMetricDirection>(['maximize', 'minimize']);
const TARGET_COLUMNS = new Set<TargetMetricColumn>(['all', 'long', 'short']);
const FILTER_OPERATORS = new Set<FilterOperator>(['>=', '<=', '>', '<', '==', '!=']);

export const MAX_TOTAL_TRIALS = 10000;
export const MAX_PARAMETERS = 128;
export const MAX_FILTERS = 64;
export const MAX_HISTORY_RUN_SELECTION = 100;
export const MAX_DROPDOWN_OPTIONS = 256;
export const MAX_TRIAL_PARAM_KEYS = 128;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = '', maxLength = 256): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeNumericParam(param: Record<string, unknown>): StrategyParameter | null {
  const id = asString(param.id, '', 80);
  const label = asString(param.label, '', 120);
  if (!id || !label) return null;

  const section = asString(param.section, '', 120);
  const enabled = asBoolean(param.enabled, true);
  const currentValue = asFiniteNumber(param.currentValue, 0);
  const normalizedRange = normalizeNumericRange({
    currentValue,
    min: asFiniteNumber(param.min, currentValue - 1),
    max: asFiniteNumber(param.max, currentValue + 1),
    step: asFiniteNumber(param.step, 1),
  });

  return {
    id,
    label,
    section,
    type: 'numeric',
    enabled,
    currentValue,
    min: normalizedRange.min,
    max: normalizedRange.max,
    step: normalizedRange.step,
  };
}

function sanitizeCheckboxParam(param: Record<string, unknown>): StrategyParameter | null {
  const id = asString(param.id, '', 80);
  const label = asString(param.label, '', 120);
  if (!id || !label) return null;

  return {
    id,
    label,
    section: asString(param.section, '', 120),
    type: 'checkbox',
    enabled: asBoolean(param.enabled, false),
    currentValue: asBoolean(param.currentValue, false),
    optimize: asBoolean(param.optimize, false),
  };
}

function sanitizeDropdownParam(param: Record<string, unknown>): StrategyParameter | null {
  const id = asString(param.id, '', 80);
  const label = asString(param.label, '', 120);
  if (!id || !label) return null;

  const rawOptions = Array.isArray(param.options) ? param.options : [];
  const options: string[] = [];
  const seenOptions = new Set<string>();
  for (const rawOption of rawOptions) {
    const option = asString(rawOption, '', 120);
    if (!option || seenOptions.has(option)) continue;
    seenOptions.add(option);
    options.push(option);
    if (options.length >= MAX_DROPDOWN_OPTIONS) break;
  }
  if (options.length === 0) return null;

  const currentValue = asString(param.currentValue, options[0], 120) || options[0];
  const rawSelected = Array.isArray(param.selectedOptions) ? param.selectedOptions : [];
  const selectedSet = new Set(rawSelected.map((opt) => asString(opt, '', 120)).filter((opt) => options.includes(opt)));
  if (selectedSet.size === 0 && options.includes(currentValue)) {
    selectedSet.add(currentValue);
  }

  return {
    id,
    label,
    section: asString(param.section, '', 120),
    type: 'dropdown',
    enabled: asBoolean(param.enabled, false),
    currentValue,
    options,
    selectedOptions: [...selectedSet],
  };
}

function sanitizeStrategyParameter(value: unknown): StrategyParameter | null {
  const param = asRecord(value);
  if (!param) return null;
  const type = asString(param.type, '');
  if (type === 'numeric') return sanitizeNumericParam(param);
  if (type === 'checkbox') return sanitizeCheckboxParam(param);
  if (type === 'dropdown') return sanitizeDropdownParam(param);
  return null;
}

function ensureUniqueParameterIds(params: StrategyParameter[]): StrategyParameter[] {
  const seen = new Map<string, number>();
  return params.map((param) => {
    const nextCount = (seen.get(param.id) ?? 0) + 1;
    seen.set(param.id, nextCount);
    if (nextCount === 1) return param;
    return {
      ...param,
      id: `${param.id}_${nextCount}`,
    };
  });
}

function createUniqueFilterId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  let suffix = 2;
  let candidate = `${baseId}_${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}_${suffix}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function sanitizeFilters(value: unknown): Filter[] {
  const rawFilters = Array.isArray(value) ? value : [];
  const filters: Filter[] = [];
  const usedFilterIds = new Set<string>();

  for (const [index, raw] of rawFilters.slice(0, MAX_FILTERS).entries()) {
    const filter = asRecord(raw);
    if (!filter) continue;
    const operatorRaw = asString(filter.operator, '>=');
    const operator = FILTER_OPERATORS.has(operatorRaw as FilterOperator) ? (operatorRaw as FilterOperator) : '>=';
    const baseId = asString(filter.id, '', 80) || `filter_${index + 1}`;
    filters.push({
      id: createUniqueFilterId(baseId, usedFilterIds),
      metricName: asString(filter.metricName, 'Total trades', 120),
      operator,
      value: asFiniteNumber(filter.value, 0),
      enabled: asBoolean(filter.enabled, true),
    });
  }

  return filters;
}

function sanitizeAntiDetection(value: unknown): AntiDetectionConfig {
  const raw = asRecord(value);
  if (!raw) {
    return { enabled: true, minDelay: 200, maxDelay: 600 };
  }
  const minDelay = clamp(Math.round(asFiniteNumber(raw.minDelay, 200)), 50, 60000);
  const maxDelay = clamp(Math.round(asFiniteNumber(raw.maxDelay, 600)), minDelay, 120000);
  return {
    enabled: asBoolean(raw.enabled, true),
    minDelay,
    maxDelay,
  };
}

function sanitizeSelectedHistoryRunIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of value) {
    const id = asString(raw, '', 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (output.length >= MAX_HISTORY_RUN_SELECTION) break;
  }
  return output;
}

export function sanitizeOptimizationConfigInput(
  value: unknown,
  defaults?: Partial<OptimizationConfig>,
): Omit<OptimizationConfig, 'id' | 'createdAt' | 'updatedAt'> {
  const input = asRecord(value);
  if (!input) {
    throw new Error('Invalid optimization config payload.');
  }

  const runModeRaw = asString(input.runMode, defaults?.runMode ?? 'fresh');
  const runMode: RunMode = RUN_MODES.has(runModeRaw as RunMode) ? (runModeRaw as RunMode) : 'fresh';

  const samplerRaw = asString(input.sampler, defaults?.sampler ?? 'auto');
  const sampler: SamplerChoice = SAMPLERS.has(samplerRaw as SamplerChoice)
    ? (samplerRaw as SamplerChoice)
    : 'auto';

  const directionRaw = asString(input.targetMetricDirection, defaults?.targetMetricDirection ?? 'maximize');
  const targetMetricDirection: TargetMetricDirection = TARGET_DIRECTIONS.has(
    directionRaw as TargetMetricDirection,
  )
    ? (directionRaw as TargetMetricDirection)
    : 'maximize';

  const columnRaw = asString(input.targetMetricColumn, defaults?.targetMetricColumn ?? 'all');
  const targetMetricColumn: TargetMetricColumn = TARGET_COLUMNS.has(columnRaw as TargetMetricColumn)
    ? (columnRaw as TargetMetricColumn)
    : 'all';

  const parameters = ensureUniqueParameterIds(
    (Array.isArray(input.parameters) ? input.parameters : [])
      .map((param) => sanitizeStrategyParameter(param))
      .filter((param): param is StrategyParameter => param !== null)
      .slice(0, MAX_PARAMETERS),
  );

  const totalTrials = clamp(
    Math.round(asFiniteNumber(input.totalTrials, defaults?.totalTrials ?? 50)),
    1,
    MAX_TOTAL_TRIALS,
  );

  return {
    name: asString(input.name, defaults?.name ?? 'Imported config', 120),
    strategyName: asString(input.strategyName, defaults?.strategyName ?? '', 120),
    strategyIndex: Math.max(0, Math.round(asFiniteNumber(input.strategyIndex, defaults?.strategyIndex ?? 0))),
    runMode,
    selectedHistoryRunIds: sanitizeSelectedHistoryRunIds(input.selectedHistoryRunIds),
    sampler,
    targetMetric: asString(input.targetMetric, defaults?.targetMetric ?? 'Profit factor', 120),
    targetMetricDirection,
    targetMetricColumn,
    totalTrials,
    parameters,
    filters: sanitizeFilters(input.filters),
    antiDetection: sanitizeAntiDetection(input.antiDetection),
  };
}

export function sanitizeSavedConfigImport(value: unknown, fallbackName: string): SavedConfig {
  const now = Date.now();
  const input = asRecord(value);
  if (!input) {
    throw new Error('Invalid config file format.');
  }

  const rawInnerConfig = asRecord(input.config) ?? input;
  const sanitizedConfig = sanitizeOptimizationConfigInput(rawInnerConfig, {
    strategyName: asString(input.strategyName, 'Unknown', 120),
  });

  const name = asString(input.name, fallbackName.replace(/\.json$/i, ''), 120) || `Imported ${now}`;

  return {
    id: `config_${now}`,
    name,
    strategyName: asString(input.strategyName, sanitizedConfig.strategyName || 'Unknown', 120),
    config: sanitizedConfig,
    createdAt: now,
    updatedAt: now,
  };
}

export function sanitizeTrialParamsInput(value: unknown): TrialParams | null {
  const input = asRecord(value);
  if (!input) return null;

  const output: TrialParams = {};
  const keys = Object.keys(input).slice(0, MAX_TRIAL_PARAM_KEYS);
  for (const key of keys) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) continue;
    const raw = input[key];
    if (typeof raw === 'boolean') {
      output[key] = raw;
      continue;
    }
    if (typeof raw === 'string') {
      output[key] = raw.slice(0, 120);
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      output[key] = raw;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}
