import type { SearchSpaceParam } from './messages';
import type { Filter, OptimizationConfig, StrategyParameter } from './types';
import { normalizeNumericRange } from './parameter-normalization';

export interface StudyIdentity {
  familyName: string;
  studyName: string;
  signature: string;
}

export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function sanitizeStudyBase(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  return `${sanitized}_${stableHash(name)}`;
}

export function buildSearchSpace(params: StrategyParameter[]): SearchSpaceParam[] {
  const space: SearchSpaceParam[] = [];

  for (const param of params) {
    if (!param.enabled) continue;

    switch (param.type) {
      case 'numeric': {
        const { min, max, step } = normalizeNumericRange({
          currentValue: param.currentValue,
          min: param.min,
          max: param.max,
          step: param.step,
        });
        space.push({
          name: param.id,
          type: Number.isInteger(min) && Number.isInteger(max) && step >= 1 ? 'int' : 'float',
          low: min,
          high: max,
          step,
        });
        break;
      }
      case 'checkbox':
        if (param.optimize) {
          space.push({
            name: param.id,
            type: 'categorical',
            choices: [true, false],
          });
        }
        break;
      case 'dropdown':
        if (param.selectedOptions.length > 1) {
          space.push({
            name: param.id,
            type: 'categorical',
            choices: param.selectedOptions,
          });
        }
        break;
    }
  }

  return space;
}

function normalizeSearchSpaceForSignature(searchSpace: SearchSpaceParam[]) {
  return [...searchSpace]
    .map((param) => {
      if (param.type === 'categorical') {
        return {
          name: param.name,
          type: param.type,
          choices: [...(param.choices ?? [])].map((choice) => String(choice)).sort(),
        };
      }
      return {
        name: param.name,
        type: param.type,
        low: param.low,
        high: param.high,
        step: param.step ?? null,
        log: param.log ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeFiltersForSignature(filters: Filter[]) {
  return filters
    .filter((filter) => filter.enabled)
    .map((filter) => ({
      metricName: filter.metricName,
      operator: filter.operator,
      value: filter.value,
    }))
    .sort((a, b) =>
      `${a.metricName}|${a.operator}|${a.value}`.localeCompare(`${b.metricName}|${b.operator}|${b.value}`),
    );
}

export function resolveStudyIdentity(
  config: Pick<
    OptimizationConfig,
    'strategyName' | 'runMode' | 'targetMetric' | 'targetMetricDirection' | 'targetMetricColumn' | 'filters'
  >,
  searchSpace: SearchSpaceParam[],
): StudyIdentity {
  const base = sanitizeStudyBase(config.strategyName);
  const signaturePayload = JSON.stringify({
    version: 1,
    strategy: config.strategyName,
    objective: {
      metric: config.targetMetric,
      direction: config.targetMetricDirection,
      column: config.targetMetricColumn,
    },
    searchSpace: normalizeSearchSpaceForSignature(searchSpace),
    filters: normalizeFiltersForSignature(config.filters),
  });
  const signature = stableHash(signaturePayload);
  const familyName = `${base}_cfg_${signature}`;

  if (config.runMode === 'warm_start') {
    const warmSuffix = Date.now().toString(36);
    return {
      familyName,
      studyName: `${familyName}_warm_${warmSuffix}`,
      signature,
    };
  }

  return {
    familyName,
    studyName: familyName,
    signature,
  };
}

export function resolveFamilyName(
  config: Pick<
    OptimizationConfig,
    'strategyName' | 'targetMetric' | 'targetMetricDirection' | 'targetMetricColumn' | 'filters' | 'parameters'
  >,
): string | null {
  const searchSpace = buildSearchSpace(config.parameters);
  if (searchSpace.length === 0) return null;
  return resolveStudyIdentity(
    {
      strategyName: config.strategyName,
      runMode: 'fresh',
      targetMetric: config.targetMetric,
      targetMetricDirection: config.targetMetricDirection,
      targetMetricColumn: config.targetMetricColumn,
      filters: config.filters,
    },
    searchSpace,
  ).familyName;
}
