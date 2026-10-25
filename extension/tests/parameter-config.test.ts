import { describe, expect, it } from 'bun:test';

import {
  applyParameterConfigEdit,
  createParameterConfigs,
} from '../lib/optimisation/parameter-config';
import type { StrategyInput } from '../lib/tradingview/types';

const inputs: StrategyInput[] = [
  {
    id: 'atr',
    label: 'ATR Period',
    type: 'integer',
    currentValue: 14,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    id: 'mode',
    label: 'Stop-Loss Type',
    type: 'categorical',
    currentValue: 'ATR Bars',
    options: ['ATR Bars', 'Percent', 'Swing H/L'],
  },
];

const requireConfig = (configs: ReturnType<typeof createParameterConfigs>, id: string) => {
  const config = configs[id];
  if (!config) {
    throw new Error('Missing config: ' + id);
  }
  return config;
};

describe('parameter configuration', () => {
  it('auto-enables a selected condition controller', () => {
    let configs = createParameterConfigs(inputs);

    configs = applyParameterConfigEdit(configs, inputs, {
      type: 'condition',
      id: 'atr',
      parameterId: 'mode',
    });

    expect(requireConfig(configs, 'mode').enabled).toBe(true);
    expect(requireConfig(configs, 'atr')).toMatchObject({
      conditionParameter: 'mode',
      conditionValues: ['ATR Bars'],
    });
  });

  it('clears dependants when their controller is disabled', () => {
    let configs = createParameterConfigs(inputs);

    configs = applyParameterConfigEdit(configs, inputs, {
      type: 'condition',
      id: 'atr',
      parameterId: 'mode',
    });
    configs = applyParameterConfigEdit(configs, inputs, {
      type: 'enabled',
      id: 'mode',
      enabled: false,
    });

    expect(requireConfig(configs, 'atr')).toMatchObject({
      conditionParameter: '',
      conditionValues: [],
    });
  });

  it('removes deselected controller values from dependant conditions', () => {
    let configs = createParameterConfigs(inputs);

    configs = applyParameterConfigEdit(configs, inputs, {
      type: 'condition',
      id: 'atr',
      parameterId: 'mode',
    });
    configs = applyParameterConfigEdit(configs, inputs, {
      type: 'choice',
      id: 'mode',
      choice: 'ATR Bars',
    });

    expect(requireConfig(configs, 'atr').conditionValues).toEqual([]);
  });
});
