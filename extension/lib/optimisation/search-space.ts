import type {
  ParameterCondition,
  Primitive,
  SearchParameter,
} from '../protocol/types';
import type { StrategyInput } from '../tradingview/types';

export interface ParameterConfig {
  enabled: boolean;
  low: string;
  high: string;
  step: string;
  log: boolean;
  choices: Primitive[];
  conditionParameter: string;
  conditionValues: Primitive[];
}

export const isPrimitive = (value: unknown): value is Primitive =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

export const isOptimisableInput = (input: StrategyInput): boolean =>
  input.type === 'integer' ||
  input.type === 'float' ||
  input.type === 'boolean' ||
  (input.type === 'categorical' &&
    (input.options?.filter(isPrimitive).length ?? 0) >= 2);

export const defaultParameterConfig = (
  input: StrategyInput,
): ParameterConfig => ({
  enabled: false,
  low:
    input.type === 'integer' || input.type === 'float'
      ? input.min?.toString() ?? ''
      : '',
  high:
    input.type === 'integer' || input.type === 'float'
      ? input.max?.toString() ?? ''
      : '',
  // Blank means Auto. buildSearchSpace resolves the Pine-declared
  // granularity when available, otherwise integer=1 and float=continuous.
  step: '',
  log: false,
  choices:
    input.type === 'boolean'
      ? [false, true]
      : input.type === 'categorical'
        ? (input.options ?? []).filter(isPrimitive)
        : [],
  conditionParameter: '',
  conditionValues: [],
});

const numberOrThrow = (value: string, label: string): number => {
  if (!value.trim()) {
    throw new Error('Enter ' + label.toLowerCase());
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(label + ' must be a valid number');
  }
  return parsed;
};

const conditionFor = (
  config: ParameterConfig,
  previouslyEnabled: Set<string>,
): ParameterCondition | undefined => {
  if (!config.conditionParameter) return undefined;

  if (!previouslyEnabled.has(config.conditionParameter)) {
    throw new Error(
      'Conditional parameters must depend on an earlier enabled parameter',
    );
  }

  if (config.conditionValues.length === 0) {
    throw new Error('Select at least one value for the parameter condition');
  }

  return {
    parameter: config.conditionParameter,
    values: config.conditionValues,
  };
};

export const buildSearchSpace = (
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
): SearchParameter[] => {
  const parameters: SearchParameter[] = [];
  const enabledSeen = new Set<string>();

  for (const input of inputs) {
    const config = configs[input.id];
    if (!config?.enabled) continue;

    const condition = conditionFor(config, enabledSeen);

    if (input.type === 'boolean' || input.type === 'categorical') {
      const choices = config.choices.filter(isPrimitive);
      if (choices.length < 2) {
        throw new Error(
          input.label + ' must have at least two selected choices',
        );
      }

      parameters.push({
        type: 'categorical',
        name: input.id,
        choices,
        ...(condition ? { condition } : {}),
      });
      enabledSeen.add(input.id);
      continue;
    }

    if (input.type === 'integer' || input.type === 'float') {
      const low = numberOrThrow(config.low, input.label + ' minimum');
      const high = numberOrThrow(config.high, input.label + ' maximum');

      if (low >= high) {
        throw new Error(input.label + ' minimum must be below its maximum');
      }

      if (config.log && low <= 0) {
        throw new Error(
          input.label + ' logarithmic range requires a positive minimum',
        );
      }

      if (input.type === 'integer') {
        if (!Number.isInteger(low) || !Number.isInteger(high)) {
          throw new Error(input.label + ' requires integer bounds');
        }

        const automaticStep =
          typeof input.step === 'number' &&
          Number.isInteger(input.step) &&
          input.step > 0
            ? input.step
            : 1;
        const step = config.log
          ? 1
          : config.step
            ? numberOrThrow(
                config.step,
                input.label + ' step',
              )
            : automaticStep;

        if (!Number.isInteger(step) || step <= 0) {
          throw new Error(
            input.label + ' step must be a positive integer',
          );
        }

        if (config.log && step !== 1) {
          throw new Error(
            input.label + ' logarithmic integer search requires step 1',
          );
        }

        parameters.push({
          type: 'int',
          name: input.id,
          low,
          high,
          step,
          log: config.log,
          ...(condition ? { condition } : {}),
        });
      } else {
        const automaticStep =
          typeof input.step === 'number' &&
          input.step > 0
            ? input.step
            : undefined;
        const step = config.log
          ? undefined
          : config.step
            ? numberOrThrow(
                config.step,
                input.label + ' step',
              )
            : automaticStep;

        if (step !== undefined && step <= 0) {
          throw new Error(input.label + ' step must be positive');
        }

        if (config.log && step !== undefined) {
          throw new Error(
            input.label + ' cannot combine logarithmic search with a fixed step',
          );
        }

        parameters.push({
          type: 'float',
          name: input.id,
          low,
          high,
          ...(step !== undefined ? { step } : {}),
          log: config.log,
          ...(condition ? { condition } : {}),
        });
      }

      enabledSeen.add(input.id);
    }
  }

  if (parameters.length === 0) {
    throw new Error('Select at least one parameter to optimise');
  }

  return parameters;
};

export const conditionCandidatesFor = (
  inputId: string,
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
): StrategyInput[] => {
  const index = inputs.findIndex((input) => input.id === inputId);
  if (index <= 0) return [];

  return inputs
    .slice(0, index)
    .filter((input) => configs[input.id]?.enabled)
    .filter(
      (input) =>
        input.type === 'boolean' ||
        input.type === 'categorical',
    );
};


export const buildBaselineParameters = (
  inputs: StrategyInput[],
  searchSpace: SearchParameter[],
): Record<string, Primitive> => {
  const inputById = new Map(
    inputs.map((input) => [input.id, input]),
  );
  const baseline: Record<string, Primitive> = {};

  for (const parameter of searchSpace) {
    if (parameter.condition) {
      const parent = baseline[parameter.condition.parameter];
      if (
        parent === undefined ||
        !parameter.condition.values.some(
          (value) => value === parent,
        )
      ) {
        continue;
      }
    }

    const current = inputById.get(parameter.name)?.currentValue;
    if (!isPrimitive(current)) return {};

    if (parameter.type === 'categorical') {
      if (!parameter.choices.some((choice) => choice === current)) {
        return {};
      }
      baseline[parameter.name] = current;
      continue;
    }

    if (typeof current !== 'number') return {};
    if (current < parameter.low || current > parameter.high) {
      return {};
    }

    if (parameter.type === 'int' && !Number.isInteger(current)) {
      return {};
    }

    baseline[parameter.name] = current;
  }

  return baseline;
};
