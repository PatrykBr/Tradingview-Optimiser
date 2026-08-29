import { describe, expect, it } from 'vitest';

import { reconcilePresetParameterConfigs } from '../lib/optimisation/presets';
import { defaultParameterConfig } from '../lib/optimisation/search-space';
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

describe('saved strategy configurations', () => {
  it('restores saved parameter settings against the current input model', () => {
    const saved = {
      in_0: {
        ...defaultParameterConfig(inputs[0]!),
        enabled: true,
        low: '5',
        high: '30',
        step: '1',
      },
      in_1: {
        ...defaultParameterConfig(inputs[1]!),
        enabled: true,
        choices: [true, false],
      },
    };

    expect(reconcilePresetParameterConfigs(inputs, saved)).toEqual(saved);
  });

  it('falls back safely for inputs missing from an older saved config', () => {
    const restored = reconcilePresetParameterConfigs(inputs, {
      in_0: {
        ...defaultParameterConfig(inputs[0]!),
        enabled: true,
        low: '10',
        high: '20',
      },
    });

    expect(restored.in_0?.enabled).toBe(true);
    expect(restored.in_1).toEqual(
      defaultParameterConfig(inputs[1]!),
    );
  });
});
