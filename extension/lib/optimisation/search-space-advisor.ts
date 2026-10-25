import type { StrategyInput } from '../tradingview/types';
import type { ParameterConfig } from './parameter-config';

type AdviceSeverity = 'good' | 'info' | 'warning';

interface SearchSpaceAdviceItem {
  severity: AdviceSeverity;
  title: string;
  detail: string;
}

interface SearchSpaceAdvice {
  selectedParameters: number;
  continuousParameters: number;
  categoricalParameters: number;
  conditionalParameters: number;
  discreteCombinations: number | null;
  recommendedTrials: {
    minimum: number;
    comfortable: number;
  };
  items: SearchSpaceAdviceItem[];
}

const finite = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const automaticStep = (input: StrategyInput, config: ParameterConfig): number | null => {
  if (config.log) {
    return input.type === 'integer' ? 1 : null;
  }

  const manual = finite(config.step);
  if (manual !== null && manual > 0) {
    return manual;
  }

  if (typeof input.step === 'number' && input.step > 0) {
    return input.step;
  }

  return input.type === 'integer' ? 1 : null;
};

const capProduct = (left: number, right: number): number => {
  const product = left * right;
  return Number.isSafeInteger(product) ? Math.min(product, 1_000_000_000) : 1_000_000_000;
};

const addConditionAdvice = (
  input: StrategyInput,
  config: ParameterConfig,
  configs: Record<string, ParameterConfig>,
  targetTrials: number,
  items: SearchSpaceAdviceItem[],
): void => {
  const controller = configs[config.conditionParameter];
  if (!controller || controller.choices.length === 0) return;
  const activeFraction = config.conditionValues.length / controller.choices.length;
  const expectedActive = targetTrials * activeFraction;

  if (activeFraction > 0 && expectedActive < 20) {
    items.push({
      severity: 'warning',
      title: input.label + ' may be under-sampled',
      detail:
        'Its condition is expected to be active in roughly ' +
        Math.round(activeFraction * 100) +
        '% of trials, giving only about ' +
        Math.round(expectedActive) +
        ' active trials at the current budget.',
    });
  }
};

const addRangeAdvice = (
  input: StrategyInput,
  config: ParameterConfig,
  low: number,
  high: number,
  items: SearchSpaceAdviceItem[],
): void => {
  if (
    typeof input.currentValue === 'number' &&
    (input.currentValue < low || input.currentValue > high)
  ) {
    items.push({
      severity: 'warning',
      title: input.label + ' excludes the current value',
      detail:
        'The current value is outside the search range. It cannot be the baseline for this parameter.',
    });
  }

  if (!config.log && low > 0 && high / low >= 100) {
    items.push({
      severity: 'info',
      title: input.label + ' has a maximum at least 100 times its minimum',
      detail:
        'Consider logarithmic search if ratios matter more than fixed increments for this parameter.',
    });
  }

  const currentMagnitude =
    typeof input.currentValue === 'number' ? Math.max(Math.abs(input.currentValue), 1) : 1;
  if (Math.abs(high - low) / currentMagnitude > 1_000) {
    items.push({
      severity: 'warning',
      title: input.label + ' has an unusually broad range',
      detail:
        "The range width exceeds 1,000 times the larger of 1 and the current value's magnitude. Check the limits before starting.",
    });
  }
};

const analyseNumericParameter = (
  input: StrategyInput,
  config: ParameterConfig,
  items: SearchSpaceAdviceItem[],
) => {
  const low = finite(config.low);
  const high = finite(config.high);
  const step = automaticStep(input, config);

  if (low === null || high === null || low >= high) {
    items.push({
      severity: 'warning',
      title: input.label + ' needs a valid range',
      detail: 'Set numeric limits with the minimum below the maximum.',
    });
    return { continuous: false, count: null };
  }

  addRangeAdvice(input, config, low, high, items);

  if (input.type === 'float' && step === null) {
    return { continuous: true, count: null };
  }

  if (step === null || step <= 0) return { continuous: false, count: null };
  const count = Math.floor((high - low) / step) + 1;
  return { continuous: false, count: count > 0 ? count : 1 };
};

export const analyseSearchSpace = (
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
  targetTrialsRaw: string,
): SearchSpaceAdvice => {
  const enabled = inputs.filter((input) => configs[input.id]?.enabled);
  const targetTrials = Math.max(1, Math.floor(Number(targetTrialsRaw) || 1));

  let continuousParameters = 0;
  let categoricalParameters = 0;
  let conditionalParameters = 0;
  let discreteCombinations = 1;
  let fullyDiscrete = true;
  const items: SearchSpaceAdviceItem[] = [];

  enabled.forEach((input) => {
    const config = configs[input.id];
    if (!config) return;

    if (config.conditionParameter) {
      conditionalParameters += 1;
      addConditionAdvice(input, config, configs, targetTrials, items);
    }

    if (input.type === 'boolean' || input.type === 'categorical') {
      categoricalParameters += 1;
      const count = config.choices.length;

      if (count >= 2) {
        discreteCombinations = capProduct(discreteCombinations, count);
      }
      return;
    }

    if (input.type !== 'integer' && input.type !== 'float') {
      return;
    }

    const numeric = analyseNumericParameter(input, config, items);
    continuousParameters += Number(numeric.continuous);
    if (numeric.count === null) fullyDiscrete = false;
    else discreteCombinations = capProduct(discreteCombinations, numeric.count);
  });

  const selectedParameters = enabled.length;
  const complexity =
    selectedParameters * 22 +
    continuousParameters * 35 +
    categoricalParameters * 12 +
    conditionalParameters * 18;

  let recommendedMinimum = Math.max(20, Math.round(40 + complexity));

  if (fullyDiscrete && discreteCombinations > 0) {
    recommendedMinimum = Math.min(recommendedMinimum, discreteCombinations);
  }

  const comfortable = Math.min(
    100_000,
    Math.max(recommendedMinimum, Math.round(recommendedMinimum * 1.75)),
  );

  if (selectedParameters > 0 && targetTrials < recommendedMinimum) {
    items.unshift({
      severity: 'warning',
      title: 'Trial budget is below the estimate for this search space',
      detail:
        'The current budget is ' +
        targetTrials +
        ' trials. The estimated range is ' +
        recommendedMinimum +
        ' to ' +
        comfortable +
        '. This estimate does not guarantee enough trials.',
    });
  } else if (selectedParameters > 0) {
    items.unshift({
      severity: 'good',
      title: 'Trial budget meets the estimate',
      detail: 'The budget is at or above the estimated minimum for the selected parameters.',
    });
  }

  if (fullyDiscrete && discreteCombinations > 0 && targetTrials >= discreteCombinations) {
    items.push({
      severity: 'info',
      title: 'Trial budget can cover the whole discrete space',
      detail:
        'There are approximately ' +
        discreteCombinations.toLocaleString() +
        ' discrete combinations before conditional branches. More trials may repeat equivalent combinations.',
    });
  }

  return {
    selectedParameters,
    continuousParameters,
    categoricalParameters,
    conditionalParameters,
    discreteCombinations: fullyDiscrete ? discreteCombinations : null,
    recommendedTrials: {
      minimum: recommendedMinimum,
      comfortable,
    },
    items,
  };
};
