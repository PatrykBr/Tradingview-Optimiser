import type { ParameterCondition, Primitive, SearchParameter } from '../protocol/types';
import type { StrategyInput } from '../tradingview/types';
import { isOptimisableInput, isPrimitive, type ParameterConfig } from './parameter-config';

type FloatSearchParameter = Extract<SearchParameter, { type: 'float' }>;
type IntSearchParameter = Extract<SearchParameter, { type: 'int' }>;
const numberOrThrow = (value: string, label: string): number => {
  if (!value.trim()) {
    throw new Error('Enter ' + label.toLowerCase());
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(label + ' must be a valid number');
  }

  return parsed;
};

const conditionFor = (
  input: StrategyInput,
  config: ParameterConfig,
  enabledIds: Set<string>,
  inputById: Map<string, StrategyInput>,
): ParameterCondition | undefined => {
  if (!config.conditionParameter) {
    return undefined;
  }

  if (config.conditionParameter === input.id) {
    throw new Error(input.label + ' cannot depend on itself');
  }

  if (!enabledIds.has(config.conditionParameter)) {
    throw new Error('Condition controller must also be enabled for optimisation');
  }

  const parent = inputById.get(config.conditionParameter);
  if (!parent || (parent.type !== 'boolean' && parent.type !== 'categorical')) {
    throw new Error(input.label + ' must depend on a boolean or dropdown parameter');
  }

  if (config.conditionValues.length === 0) {
    throw new Error('Select at least one active value for ' + input.label);
  }

  return {
    parameter: config.conditionParameter,
    values: config.conditionValues,
  };
};

const sortByDependencies = (parameters: SearchParameter[]): SearchParameter[] => {
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: SearchParameter[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;

    if (visiting.has(name)) {
      throw new Error('Conditional parameter dependencies contain a cycle');
    }

    const parameter = byName.get(name);
    if (!parameter) {
      throw new Error('Unknown condition controller: ' + name);
    }

    visiting.add(name);

    if (parameter.condition) {
      visit(parameter.condition.parameter);
    }

    visiting.delete(name);
    visited.add(name);
    ordered.push(parameter);
  };

  for (const parameter of parameters) {
    visit(parameter.name);
  }

  return ordered;
};

const attachCondition = <T extends SearchParameter>(
  parameter: T,
  condition: ParameterCondition | undefined,
): T => {
  if (condition) {
    parameter.condition = condition;
  }

  return parameter;
};

const numericStep = (input: StrategyInput, config: ParameterConfig): number | undefined => {
  const integer = input.type === 'integer';
  if (config.log) return integer ? 1 : undefined;
  if (config.step) return numberOrThrow(config.step, input.label + ' step');
  if (
    typeof input.step === 'number' &&
    input.step > 0 &&
    (!integer || Number.isInteger(input.step))
  ) {
    return input.step;
  }
  return integer ? 1 : undefined;
};

const numericParameter = (
  input: StrategyInput,
  config: ParameterConfig,
): FloatSearchParameter | IntSearchParameter => {
  const low = numberOrThrow(config.low, input.label + ' minimum');
  const high = numberOrThrow(config.high, input.label + ' maximum');
  if (low >= high) throw new Error(input.label + ' minimum must be below its maximum');
  if (config.log && low <= 0)
    throw new Error(input.label + ' logarithmic range requires a positive minimum');

  const step = numericStep(input, config);
  if (input.type === 'integer') {
    if (!Number.isInteger(low) || !Number.isInteger(high))
      throw new TypeError(input.label + ' requires integer bounds');
    if (step === undefined || !Number.isInteger(step) || step <= 0)
      throw new Error(input.label + ' step must be a positive integer');
    return { type: 'int', name: input.id, low, high, step, log: config.log };
  }
  if (step !== undefined && step <= 0) throw new Error(input.label + ' step must be positive');
  return {
    type: 'float',
    name: input.id,
    low,
    high,
    log: config.log,
    ...(step === undefined ? {} : { step }),
  };
};

const searchParameter = (input: StrategyInput, config: ParameterConfig): SearchParameter | null => {
  if (input.type === 'boolean' || input.type === 'categorical') {
    const choices = config.choices.filter(isPrimitive);
    if (choices.length < 2)
      throw new Error(input.label + ' must have at least two selected choices');
    return { type: 'categorical', name: input.id, choices };
  }
  if (input.type === 'integer' || input.type === 'float') return numericParameter(input, config);
  return null;
};

export const buildSearchSpace = (
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
): SearchParameter[] => {
  const parameters: SearchParameter[] = [];
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const enabledIds = new Set(
    inputs
      .filter((input) => configs[input.id]?.enabled && isOptimisableInput(input))
      .map((input) => input.id),
  );
  for (const input of inputs) {
    const config = configs[input.id];
    if (!config?.enabled) continue;
    const condition = conditionFor(input, config, enabledIds, inputById);
    const parameter = searchParameter(input, config);
    if (parameter) parameters.push(attachCondition(parameter, condition));
  }
  if (parameters.length === 0) throw new Error('Select at least one parameter to optimise');
  return sortByDependencies(parameters);
};

const isBaselineValue = (current: unknown, parameter: SearchParameter): current is Primitive => {
  if (!isPrimitive(current)) return false;
  if (parameter.type === 'categorical') return parameter.choices.includes(current);
  if (typeof current !== 'number' || current < parameter.low || current > parameter.high)
    return false;
  if (parameter.type === 'int' && !Number.isInteger(current)) return false;
  const step = parameter.step ?? (parameter.type === 'int' ? 1 : undefined);
  if (step === undefined) return true;
  const index = (current - parameter.low) / step;
  return Math.abs(index - Math.round(index)) <= 1e-8;
};

export const buildBaselineParameters = (
  inputs: StrategyInput[],
  searchSpace: SearchParameter[],
): Record<string, Primitive> => {
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const baseline: Record<string, Primitive> = {};

  for (const parameter of searchSpace) {
    if (parameter.condition) {
      const parent = baseline[parameter.condition.parameter];

      if (parent === undefined || !parameter.condition.values.includes(parent)) {
        continue;
      }
    }

    const current = inputById.get(parameter.name)?.currentValue;

    if (!isBaselineValue(current, parameter)) return {};

    baseline[parameter.name] = current;
  }

  return baseline;
};
