import type { Primitive } from '../protocol/types';
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

export type ParameterConfigEdit =
  | {
      type: 'enabled';
      id: string;
      enabled: boolean;
    }
  | {
      type: 'field';
      id: string;
      field: 'low' | 'high' | 'step';
      value: string;
    }
  | {
      type: 'log';
      id: string;
      log: boolean;
    }
  | {
      type: 'choice';
      id: string;
      choice: Primitive;
    }
  | {
      type: 'condition';
      id: string;
      parameterId: string;
    }
  | {
      type: 'condition-value';
      id: string;
      value: Primitive;
    };

export const isPrimitive = (
  value: unknown,
): value is Primitive =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

export const isParameterConfig = (
  value: unknown,
): value is ParameterConfig => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;
  const expectedKeys = new Set([
    'enabled',
    'low',
    'high',
    'step',
    'log',
    'choices',
    'conditionParameter',
    'conditionValues',
  ]);

  if (
    Object.keys(record).length !==
      expectedKeys.size ||
    Object.keys(record).some(
      (key) => !expectedKeys.has(key),
    )
  ) {
    return false;
  }

  return (
    typeof record.enabled === 'boolean' &&
    typeof record.low === 'string' &&
    typeof record.high === 'string' &&
    typeof record.step === 'string' &&
    typeof record.log === 'boolean' &&
    Array.isArray(record.choices) &&
    record.choices.every(isPrimitive) &&
    typeof record.conditionParameter ===
      'string' &&
    Array.isArray(
      record.conditionValues,
    ) &&
    record.conditionValues.every(
      isPrimitive,
    )
  );
};

export const isOptimisableInput = (
  input: StrategyInput,
): boolean =>
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
  // Blank means Auto. Search-space construction resolves Pine's declared
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

export const createParameterConfigs = (
  inputs: StrategyInput[],
): Record<string, ParameterConfig> => {
  const configs: Record<string, ParameterConfig> = {};

  for (const input of inputs) {
    configs[input.id] =
      defaultParameterConfig(input);
  }

  return configs;
};

export const reconcileParameterConfigs = (
  inputs: StrategyInput[],
  saved: Record<string, ParameterConfig>,
): Record<string, ParameterConfig> => {
  const reconciled: Record<string, ParameterConfig> = {};

  for (const input of inputs) {
    const fallback =
      defaultParameterConfig(input);
    const stored = saved[input.id];

    if (!stored) {
      reconciled[input.id] = fallback;
      continue;
    }

    reconciled[input.id] = {
      ...fallback,
      ...stored,
      choices: Array.isArray(stored.choices)
        ? [...stored.choices]
        : fallback.choices,
      conditionValues: Array.isArray(
        stored.conditionValues,
      )
        ? [...stored.conditionValues]
        : fallback.conditionValues,
    };
  }

  return reconciled;
};

const clearDependentConditions = (
  configs: Record<string, ParameterConfig>,
  controllerId: string,
): Record<string, ParameterConfig> => {
  let next = configs;

  for (const [id, config] of Object.entries(configs)) {
    if (config.conditionParameter !== controllerId) {
      continue;
    }

    if (next === configs) {
      next = { ...configs };
    }

    next[id] = {
      ...config,
      conditionParameter: '',
      conditionValues: [],
    };
  }

  return next;
};

const removeConditionValueFromDependants = (
  configs: Record<string, ParameterConfig>,
  controllerId: string,
  removedValue: Primitive,
): Record<string, ParameterConfig> => {
  let next = configs;

  for (const [id, config] of Object.entries(configs)) {
    if (
      config.conditionParameter !== controllerId ||
      !config.conditionValues.some(
        (value) => value === removedValue,
      )
    ) {
      continue;
    }

    if (next === configs) {
      next = { ...configs };
    }

    next[id] = {
      ...config,
      conditionValues:
        config.conditionValues.filter(
          (value) => value !== removedValue,
        ),
    };
  }

  return next;
};

export const applyParameterConfigEdit = (
  configs: Record<string, ParameterConfig>,
  inputs: StrategyInput[],
  edit: ParameterConfigEdit,
): Record<string, ParameterConfig> => {
  const config = configs[edit.id];
  if (!config) return configs;

  if (edit.type === 'enabled') {
    const next = {
      ...configs,
      [edit.id]: {
        ...config,
        enabled: edit.enabled,
      },
    };

    return edit.enabled
      ? next
      : clearDependentConditions(
          next,
          edit.id,
        );
  }

  if (edit.type === 'field') {
    return {
      ...configs,
      [edit.id]: {
        ...config,
        [edit.field]: edit.value,
      },
    };
  }

  if (edit.type === 'log') {
    return {
      ...configs,
      [edit.id]: {
        ...config,
        log: edit.log,
        step: edit.log ? '' : config.step,
      },
    };
  }

  if (edit.type === 'choice') {
    const exists = config.choices.some(
      (value) => value === edit.choice,
    );
    const choices = exists
      ? config.choices.filter(
          (value) => value !== edit.choice,
        )
      : [...config.choices, edit.choice];

    const next = {
      ...configs,
      [edit.id]: {
        ...config,
        choices,
      },
    };

    return exists
      ? removeConditionValueFromDependants(
          next,
          edit.id,
          edit.choice,
        )
      : next;
  }

  if (edit.type === 'condition') {
    if (!edit.parameterId) {
      return {
        ...configs,
        [edit.id]: {
          ...config,
          conditionParameter: '',
          conditionValues: [],
        },
      };
    }

    const parent = configs[edit.parameterId];
    if (!parent) return configs;

    const parentInput = inputs.find(
      (input) => input.id === edit.parameterId,
    );
    const currentValue =
      parentInput?.currentValue;
    const preferredValue =
      isPrimitive(currentValue) &&
      parent.choices.some(
        (choice) => choice === currentValue,
      )
        ? currentValue
        : parent.choices[0];

    return {
      ...configs,
      [edit.parameterId]: {
        ...parent,
        enabled: true,
      },
      [edit.id]: {
        ...config,
        conditionParameter: edit.parameterId,
        conditionValues:
          preferredValue === undefined
            ? []
            : [preferredValue],
      },
    };
  }

  const exists = config.conditionValues.some(
    (value) => value === edit.value,
  );

  return {
    ...configs,
    [edit.id]: {
      ...config,
      conditionValues: exists
        ? config.conditionValues.filter(
            (value) => value !== edit.value,
          )
        : [
            ...config.conditionValues,
            edit.value,
          ],
    },
  };
};

export const conditionCandidatesFor = (
  inputId: string,
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
): StrategyInput[] => {
  const wouldCreateCycle = (
    candidateId: string,
  ): boolean => {
    const seen = new Set<string>();
    let current =
      configs[candidateId]?.conditionParameter ?? '';

    while (current) {
      if (current === inputId) return true;
      if (seen.has(current)) return true;

      seen.add(current);
      current =
        configs[current]?.conditionParameter ?? '';
    }

    return false;
  };

  return inputs.filter((input) => {
    if (input.id === inputId) return false;

    if (
      input.type !== 'boolean' &&
      input.type !== 'categorical'
    ) {
      return false;
    }

    if (
      input.type === 'categorical' &&
      (input.options?.filter(isPrimitive).length ??
        0) < 2
    ) {
      return false;
    }

    return !wouldCreateCycle(input.id);
  });
};
