import { describe, expect, it } from 'vitest';

import {
  defaultParameterConfig,
  reconcileParameterConfigs,
} from '../lib/optimisation/parameter-config';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'in_0',
    label: 'Length',
    type: 'integer',
    currentValue: 14,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    id: 'in_1',
    label: 'Filter',
    type: 'boolean',
    currentValue: true,
  },
];

const requireInput = (
  index: number,
): StrategyInput => {
  const input = inputs[index];

  if (!input) {
    throw new Error(
      'Missing test input at index ' +
        index,
    );
  }

  return input;
};

describe('saved strategy configurations', () => {
  it('restores saved parameter settings against the current input model', () => {
    const saved = {
      in_0: {
        ...defaultParameterConfig(requireInput(0)),
        enabled: true,
        low: '5',
        high: '30',
        step: '1',
      },
      in_1: {
        ...defaultParameterConfig(requireInput(1)),
        enabled: true,
        choices: [true, false],
      },
    };

    expect(reconcileParameterConfigs(inputs, saved)).toEqual(saved);
  });

  it('falls back safely for inputs missing from an older saved config', () => {
    const restored = reconcileParameterConfigs(inputs, {
      in_0: {
        ...defaultParameterConfig(requireInput(0)),
        enabled: true,
        low: '10',
        high: '20',
      },
    });

    expect(restored.in_0?.enabled).toBe(true);
    expect(restored.in_1).toEqual(
      defaultParameterConfig(requireInput(1)),
    );
  });
});
