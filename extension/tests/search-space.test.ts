import { describe, expect, it } from 'vitest';

import {
  buildBaselineParameters,
  buildSearchSpace,
  defaultParameterConfig,
  type ParameterConfig,
} from '../lib/optimisation/search-space';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'in_0',
    label: 'Use trend filter',
    type: 'boolean',
    currentValue: true,
  },
  {
    id: 'in_1',
    label: 'ATR length',
    type: 'integer',
    currentValue: 14,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    id: 'in_2',
    label: 'Risk',
    type: 'float',
    currentValue: 1,
    min: 0.1,
    max: 5,
    step: 0.1,
  },
];

const configs = (): Record<string, ParameterConfig> =>
  Object.fromEntries(
    inputs.map((input) => [
      input.id,
      defaultParameterConfig(input),
    ]),
  );

describe('buildSearchSpace', () => {
  it('builds mixed Optuna parameters', () => {
    const config = configs();
    config.in_0!.enabled = true;
    config.in_1!.enabled = true;
    config.in_1!.low = '5';
    config.in_1!.high = '30';
    config.in_2!.enabled = true;
    config.in_2!.low = '0.5';
    config.in_2!.high = '2.5';
    config.in_2!.step = '0.1';

    expect(buildSearchSpace(inputs, config)).toEqual([
      {
        type: 'categorical',
        name: 'in_0',
        choices: [false, true],
      },
      {
        type: 'int',
        name: 'in_1',
        low: 5,
        high: 30,
        step: 1,
        log: false,
      },
      {
        type: 'float',
        name: 'in_2',
        low: 0.5,
        high: 2.5,
        step: 0.1,
        log: false,
      },
    ]);
  });

  it('builds a baseline from current chart values', () => {
    const config = configs();
    config.in_0!.enabled = true;
    config.in_1!.enabled = true;
    config.in_1!.low = '5';
    config.in_1!.high = '30';

    const searchSpace = buildSearchSpace(inputs, config);

    expect(buildBaselineParameters(inputs, searchSpace)).toEqual({
      in_0: true,
      in_1: 14,
    });
  });

  it('supports conditional dynamic search parameters', () => {
    const config = configs();
    config.in_0!.enabled = true;
    config.in_1!.enabled = true;
    config.in_1!.low = '5';
    config.in_1!.high = '30';
    config.in_1!.conditionParameter = 'in_0';
    config.in_1!.conditionValues = [true];

    expect(buildSearchSpace(inputs, config)[1]).toMatchObject({
      name: 'in_1',
      condition: {
        parameter: 'in_0',
        values: [true],
      },
    });
  });

  it('validates logarithmic ranges', () => {
    const config = configs();
    config.in_2!.enabled = true;
    config.in_2!.low = '0';
    config.in_2!.high = '10';
    config.in_2!.log = true;
    config.in_2!.step = '';

    expect(() => buildSearchSpace(inputs, config)).toThrow(
      /positive minimum/,
    );
  });

  it('requires at least two categorical choices', () => {
    const config = configs();
    config.in_0!.enabled = true;
    config.in_0!.choices = [true];

    expect(() => buildSearchSpace(inputs, config)).toThrow(
      /at least two selected choices/,
    );
  });
});
