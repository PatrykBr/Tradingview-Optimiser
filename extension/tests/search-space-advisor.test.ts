import { describe, expect, it } from 'vitest';

import { createParameterConfigs } from '../lib/optimisation/parameter-config';
import { analyseSearchSpace } from '../lib/optimisation/search-space-advisor';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'length',
    label: 'Length',
    type: 'integer',
    currentValue: 14,
    min: 5,
    max: 30,
    step: 1,
  },
  {
    id: 'multiplier',
    label: 'Multiplier',
    type: 'float',
    currentValue: 1,
    min: 0.01,
    max: 10,
  },
  {
    id: 'mode',
    label: 'Mode',
    type: 'categorical',
    currentValue: 'A',
    options: ['A', 'B', 'C'],
  },
];

const requireInput = (
  index: number,
): StrategyInput => {
  const input = inputs[index];
  if (!input) {
    throw new Error(
      'Missing advisor test input: ' +
        index,
    );
  }
  return input;
};

const enable = (
  configs: ReturnType<
    typeof createParameterConfigs
  >,
  id: string,
) => {
  const config = configs[id];
  if (!config) {
    throw new Error(
      'Missing advisor test config: ' + id,
    );
  }
  config.enabled = true;
  return config;
};

describe('search-space advisor', () => {
  it('flags a thin budget and suggests log search for very wide positive ranges', () => {
    const configs =
      createParameterConfigs(inputs);

    enable(configs, 'length');
    enable(configs, 'multiplier');
    enable(configs, 'mode');

    const advice = analyseSearchSpace(
      inputs,
      configs,
      '20',
    );

    expect(
      advice.items.some((item) =>
        /Trial budget looks thin/i.test(
          item.title,
        ),
      ),
    ).toBe(true);
    expect(
      advice.items.some((item) =>
        /spans a very wide positive scale/i.test(
          item.title,
        ),
      ),
    ).toBe(true);
  });

  it('estimates under-sampled conditional branches', () => {
    const configs =
      createParameterConfigs(inputs);

    enable(configs, 'mode');
    const length =
      enable(configs, 'length');
    length.conditionParameter = 'mode';
    length.conditionValues = ['A'];

    const advice = analyseSearchSpace(
      inputs,
      configs,
      '30',
    );

    expect(
      advice.items.some((item) =>
        /under-sampled/i.test(
          item.title,
        ),
      ),
    ).toBe(true);
  });

  it('reports discrete cardinality when every parameter is discrete', () => {
    const configs =
      createParameterConfigs([
        requireInput(0),
        requireInput(2),
      ]);

    enable(configs, 'length');
    enable(configs, 'mode');

    const advice = analyseSearchSpace(
      [requireInput(0), requireInput(2)],
      configs,
      '100',
    );

    expect(
      advice.discreteCombinations,
    ).toBe(78);
  });
});
