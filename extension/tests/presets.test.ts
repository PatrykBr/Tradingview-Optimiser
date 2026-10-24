import { mockGlobal } from './helpers/globals';
import { describe, expect, it, mock } from 'bun:test';

import {
  defaultParameterConfig,
  isParameterConfig,
  reconcileParameterConfigs,
} from '../lib/optimisation/parameter-config';
import { DEFAULT_OPTIMISATION_DRAFT } from '../lib/optimisation/draft';
import { loadStrategyPresets } from '../lib/optimisation/presets';
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

const requireInput = (index: number): StrategyInput => {
  const input = inputs[index];

  if (!input) {
    throw new Error('Missing test input at index ' + index);
  }

  return input;
};

describe('saved strategy configurations', () => {
  it('validates current parameter configuration shape', () => {
    expect(isParameterConfig(defaultParameterConfig(requireInput(0)))).toBe(true);

    expect(
      isParameterConfig({
        ...defaultParameterConfig(requireInput(0)),
        enabled: 'yes',
      }),
    ).toBe(false);
  });

  it('rejects corrupted v2 presets instead of silently defaulting them', async () => {
    mockGlobal('browser', {
      storage: {
        local: {
          get: mock(async () => ({
            strategyOptimisationPresetsV1: [
              {
                version: 2,
                id: 'preset-1',
                name: 'Broken',
                strategyName: 'Strategy',
                strategySignature: 'signature',
                parameterConfigs: {
                  in_0: defaultParameterConfig(requireInput(0)),
                },
                draft: {
                  ...DEFAULT_OPTIMISATION_DRAFT,
                  targetTrials: 100,
                },
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          })),
        },
      },
    });

    await expect(loadStrategyPresets('signature')).rejects.toThrow(/invalid v2 draft/);
  });

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
    expect(restored.in_1).toEqual(defaultParameterConfig(requireInput(1)));
  });
});
