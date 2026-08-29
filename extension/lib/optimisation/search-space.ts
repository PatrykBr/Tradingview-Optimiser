import type {
  ParameterCondition,
  Primitive,
  SearchParameter,
} from '../protocol/types';
import type { StrategyInput } from '../tradingview/types';
import {
  isOptimisableInput,
  isPrimitive,
  type ParameterConfig,
} from './parameter-config';

type FloatSearchParameter = Extract<
  SearchParameter,
  { type: 'float' }
>;
type IntSearchParameter = Extract<
  SearchParameter,
  { type: 'int' }
>;
type CategoricalSearchParameter = Extract<
  SearchParameter,
  { type: 'categorical' }
>;

const numberOrThrow = (
  value: string,
  label: string,
): number => {
  if (!value.trim()) {
    throw new Error(
      'Enter ' + label.toLowerCase(),
    );
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      label + ' must be a valid number',
    );
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
    throw new Error(
      input.label + ' cannot depend on itself',
    );
  }

  if (!enabledIds.has(config.conditionParameter)) {
    throw new Error(
      'Condition controller must also be enabled for optimisation',
    );
  }

  const parent = inputById.get(
    config.conditionParameter,
  );
  if (
    !parent ||
    (parent.type !== 'boolean' &&
      parent.type !== 'categorical')
  ) {
    throw new Error(
      input.label +
        ' must depend on a boolean or dropdown parameter',
    );
  }

  if (config.conditionValues.length === 0) {
    throw new Error(
      'Select at least one active value for ' +
        input.label,
    );
  }

  return {
    parameter: config.conditionParameter,
    values: config.conditionValues,
  };
};

const sortByDependencies = (
  parameters: SearchParameter[],
): SearchParameter[] => {
  const byName = new Map(
    parameters.map((parameter) => [
      parameter.name,
      parameter,
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: SearchParameter[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;

    if (visiting.has(name)) {
      throw new Error(
        'Conditional parameter dependencies contain a cycle',
      );
    }

    const parameter = byName.get(name);
    if (!parameter) {
      throw new Error(
        'Unknown condition controller: ' + name,
      );
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

const attachCondition = <
  T extends SearchParameter,
>(
  parameter: T,
  condition: ParameterCondition | undefined,
): T => {
  if (condition) {
    parameter.condition = condition;
  }

  return parameter;
};

export const buildSearchSpace = (
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
): SearchParameter[] => {
  const parameters: SearchParameter[] = [];
  const inputById = new Map(
    inputs.map((input) => [
      input.id,
      input,
    ]),
  );
  const enabledIds = new Set(
    inputs
      .filter(
        (input) =>
          configs[input.id]?.enabled &&
          isOptimisableInput(input),
      )
      .map((input) => input.id),
  );

  for (const input of inputs) {
    const config = configs[input.id];
    if (!config?.enabled) continue;

    const condition = conditionFor(
      input,
      config,
      enabledIds,
      inputById,
    );

    if (
      input.type === 'boolean' ||
      input.type === 'categorical'
    ) {
      const choices =
        config.choices.filter(isPrimitive);

      if (choices.length < 2) {
        throw new Error(
          input.label +
            ' must have at least two selected choices',
        );
      }

      const parameter: CategoricalSearchParameter = {
        type: 'categorical',
        name: input.id,
        choices,
      };

      parameters.push(
        attachCondition(
          parameter,
          condition,
        ),
      );
      continue;
    }

    if (
      input.type !== 'integer' &&
      input.type !== 'float'
    ) {
      continue;
    }

    const low = numberOrThrow(
      config.low,
      input.label + ' minimum',
    );
    const high = numberOrThrow(
      config.high,
      input.label + ' maximum',
    );

    if (low >= high) {
      throw new Error(
        input.label +
          ' minimum must be below its maximum',
      );
    }

    if (config.log && low <= 0) {
      throw new Error(
        input.label +
          ' logarithmic range requires a positive minimum',
      );
    }

    if (input.type === 'integer') {
      if (
        !Number.isInteger(low) ||
        !Number.isInteger(high)
      ) {
        throw new Error(
          input.label +
            ' requires integer bounds',
        );
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

      if (
        !Number.isInteger(step) ||
        step <= 0
      ) {
        throw new Error(
          input.label +
            ' step must be a positive integer',
        );
      }

      const parameter: IntSearchParameter = {
        type: 'int',
        name: input.id,
        low,
        high,
        step,
        log: config.log,
      };

      parameters.push(
        attachCondition(
          parameter,
          condition,
        ),
      );
      continue;
    }

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

    if (
      step !== undefined &&
      step <= 0
    ) {
      throw new Error(
        input.label +
          ' step must be positive',
      );
    }

    const parameter: FloatSearchParameter = {
      type: 'float',
      name: input.id,
      low,
      high,
      log: config.log,
    };

    if (step !== undefined) {
      parameter.step = step;
    }

    parameters.push(
      attachCondition(
        parameter,
        condition,
      ),
    );
  }

  if (parameters.length === 0) {
    throw new Error(
      'Select at least one parameter to optimise',
    );
  }

  return sortByDependencies(parameters);
};

export const buildBaselineParameters = (
  inputs: StrategyInput[],
  searchSpace: SearchParameter[],
): Record<string, Primitive> => {
  const inputById = new Map(
    inputs.map((input) => [
      input.id,
      input,
    ]),
  );
  const baseline: Record<string, Primitive> = {};

  for (const parameter of searchSpace) {
    if (parameter.condition) {
      const parent =
        baseline[parameter.condition.parameter];

      if (
        parent === undefined ||
        !parameter.condition.values.some(
          (value) => value === parent,
        )
      ) {
        continue;
      }
    }

    const current =
      inputById.get(
        parameter.name,
      )?.currentValue;

    if (!isPrimitive(current)) {
      return {};
    }

    if (
      parameter.type === 'categorical'
    ) {
      if (
        !parameter.choices.some(
          (choice) => choice === current,
        )
      ) {
        return {};
      }

      baseline[parameter.name] = current;
      continue;
    }

    if (typeof current !== 'number') {
      return {};
    }

    if (
      current < parameter.low ||
      current > parameter.high
    ) {
      return {};
    }

    if (
      parameter.type === 'int' &&
      !Number.isInteger(current)
    ) {
      return {};
    }

    baseline[parameter.name] = current;
  }

  return baseline;
};
