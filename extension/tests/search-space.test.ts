import { describe, expect, it } from 'vitest';

import {
  conditionCandidatesFor,
  createParameterConfigs,
  defaultParameterConfig,
  type ParameterConfig,
} from '../lib/optimisation/parameter-config';
import {
  buildBaselineParameters,
  buildSearchSpace,
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
  createParameterConfigs(inputs);

const requireConfig = (
  configs: Record<string, ParameterConfig>,
  id: string,
): ParameterConfig => {
  const config = configs[id];

  if (!config) {
    throw new Error(
      'Missing test config: ' + id,
    );
  }

  return config;
};

describe('buildSearchSpace', () => {
  it('defaults numeric steps to Auto', () => {
    const config = configs();

    expect(config.in_1?.step).toBe('');
    expect(config.in_2?.step).toBe('');
  });

  it('builds mixed Optuna parameters', () => {
    const config = configs();
    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_1').enabled = true;
    requireConfig(config, 'in_1').low = '5';
    requireConfig(config, 'in_1').high = '30';
    requireConfig(config, 'in_2').enabled = true;
    requireConfig(config, 'in_2').low = '0.5';
    requireConfig(config, 'in_2').high = '2.5';
    requireConfig(config, 'in_2').step = '0.1';

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

  it('uses Pine-declared steps automatically', () => {
    const config = configs();
    requireConfig(config, 'in_1').enabled = true;
    requireConfig(config, 'in_1').low = '5';
    requireConfig(config, 'in_1').high = '30';
    requireConfig(config, 'in_2').enabled = true;
    requireConfig(config, 'in_2').low = '0.5';
    requireConfig(config, 'in_2').high = '2.5';

    expect(buildSearchSpace(inputs, config)).toEqual([
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

  it('uses continuous float search when Pine exposes no step', () => {
    const continuousInputs: StrategyInput[] = [
      {
        id: 'in_0',
        label: 'Multiplier',
        type: 'float',
        currentValue: 1,
        min: 0.1,
        max: 3,
      },
    ];
    const config = {
      in_0: {
        ...defaultParameterConfig(
          continuousInputs[0] ?? {
            id: 'missing',
            label: 'Missing',
            type: 'unsupported',
            currentValue: null,
          },
        ),
        enabled: true,
        low: '0.1',
        high: '3',
      },
    };

    expect(
      buildSearchSpace(
        continuousInputs,
        config,
      )[0],
    ).toEqual({
      type: 'float',
      name: 'in_0',
      low: 0.1,
      high: 3,
      log: false,
    });
  });

  it('lets a custom step override Auto', () => {
    const config = configs();
    requireConfig(config, 'in_2').enabled = true;
    requireConfig(config, 'in_2').low = '0.5';
    requireConfig(config, 'in_2').high = '2.5';
    requireConfig(config, 'in_2').step = '0.25';

    expect(
      buildSearchSpace(inputs, config)[0],
    ).toMatchObject({
      type: 'float',
      step: 0.25,
    });
  });

  it('builds a baseline from current chart values', () => {
    const config = configs();
    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_1').enabled = true;
    requireConfig(config, 'in_1').low = '5';
    requireConfig(config, 'in_1').high = '30';

    const searchSpace = buildSearchSpace(inputs, config);

    expect(buildBaselineParameters(inputs, searchSpace)).toEqual({
      in_0: true,
      in_1: 14,
    });
  });

  it('allows a later dropdown to control an earlier parameter', () => {
    const conditionalInputs: StrategyInput[] = [
      {
        id: 'in_0',
        label: 'ATR period',
        type: 'integer',
        currentValue: 14,
        min: 1,
        max: 100,
        step: 1,
      },
      {
        id: 'in_1',
        label: 'Stop-Loss Type',
        type: 'categorical',
        currentValue: 'ATR Bars',
        options: ['ATR Bars', 'Percent', 'Swing H/L'],
      },
    ];

    const config =
      createParameterConfigs(
        conditionalInputs,
      );

    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_1').enabled = true;
    config.in_0!.low = '5';
    config.in_0!.high = '30';
    requireConfig(config, 'in_0').conditionParameter = 'in_1';
    requireConfig(config, 'in_0').conditionValues = ['ATR Bars'];

    const searchSpace = buildSearchSpace(
      conditionalInputs,
      config,
    );

    expect(searchSpace.map((parameter) => parameter.name)).toEqual([
      'in_1',
      'in_0',
    ]);
    expect(searchSpace[1]).toMatchObject({
      condition: {
        parameter: 'in_1',
        values: ['ATR Bars'],
      },
    });
  });

  it('offers disabled dropdowns and booleans as generic controllers', () => {
    const candidateInputs: StrategyInput[] = [
      {
        id: 'in_0',
        label: 'ATR period',
        type: 'integer',
        currentValue: 14,
      },
      {
        id: 'in_1',
        label: 'Stop-Loss Type',
        type: 'categorical',
        currentValue: 'ATR Bars',
        options: ['ATR Bars', 'Percent'],
      },
      {
        id: 'in_2',
        label: 'Override',
        type: 'boolean',
        currentValue: false,
      },
      {
        id: 'in_3',
        label: 'Numeric controller',
        type: 'float',
        currentValue: 1,
      },
    ];

    const config =
      createParameterConfigs(
        candidateInputs,
      );

    expect(
      conditionCandidatesFor(
        'in_0',
        candidateInputs,
        config,
      ).map((input) => input.id),
    ).toEqual(['in_1', 'in_2']);
  });

  it('rejects cyclic conditional dependencies', () => {
    const conditionalInputs: StrategyInput[] = [
      {
        id: 'in_0',
        label: 'Mode A',
        type: 'boolean',
        currentValue: true,
      },
      {
        id: 'in_1',
        label: 'Mode B',
        type: 'boolean',
        currentValue: false,
      },
    ];
    const config =
      createParameterConfigs(
        conditionalInputs,
      );
    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_1').enabled = true;

    requireConfig(config, 'in_0').conditionParameter = 'in_1';
    requireConfig(config, 'in_0').conditionValues = [true];
    requireConfig(config, 'in_1').conditionParameter = 'in_0';
    requireConfig(config, 'in_1').conditionValues = [true];

    expect(() =>
      buildSearchSpace(
        conditionalInputs,
        config,
      ),
    ).toThrow(/contain a cycle/);
  });

  it('supports conditional dynamic search parameters', () => {
    const config = configs();
    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_1').enabled = true;
    requireConfig(config, 'in_1').low = '5';
    requireConfig(config, 'in_1').high = '30';
    requireConfig(config, 'in_1').conditionParameter = 'in_0';
    requireConfig(config, 'in_1').conditionValues = [true];

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
    requireConfig(config, 'in_2').enabled = true;
    requireConfig(config, 'in_2').low = '0';
    requireConfig(config, 'in_2').high = '10';
    requireConfig(config, 'in_2').log = true;
    requireConfig(config, 'in_2').step = '';

    expect(() => buildSearchSpace(inputs, config)).toThrow(
      /positive minimum/,
    );
  });

  it('requires at least two categorical choices', () => {
    const config = configs();
    requireConfig(config, 'in_0').enabled = true;
    requireConfig(config, 'in_0').choices = [true];

    expect(() => buildSearchSpace(inputs, config)).toThrow(
      /at least two selected choices/,
    );
  });
});
