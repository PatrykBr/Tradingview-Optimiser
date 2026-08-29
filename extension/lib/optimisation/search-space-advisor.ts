import type { StrategyInput } from '../tradingview/types';
import type { ParameterConfig } from './parameter-config';

export type AdviceSeverity =
  | 'good'
  | 'info'
  | 'warning';

export interface SearchSpaceAdviceItem {
  severity: AdviceSeverity;
  title: string;
  detail: string;
}

export interface SearchSpaceAdvice {
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

const finite = (
  value: string,
): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
};

const automaticStep = (
  input: StrategyInput,
  config: ParameterConfig,
): number | null => {
  if (config.log) {
    return input.type === 'integer'
      ? 1
      : null;
  }

  const manual = finite(config.step);
  if (manual !== null && manual > 0) {
    return manual;
  }

  if (
    typeof input.step === 'number' &&
    input.step > 0
  ) {
    return input.step;
  }

  return input.type === 'integer'
    ? 1
    : null;
};

const capProduct = (
  left: number,
  right: number,
): number => {
  const product = left * right;
  return Number.isSafeInteger(product)
    ? Math.min(product, 1_000_000_000)
    : 1_000_000_000;
};

export const analyseSearchSpace = (
  inputs: StrategyInput[],
  configs: Record<string, ParameterConfig>,
  targetTrialsRaw: string,
): SearchSpaceAdvice => {
  const enabled = inputs.filter(
    (input) =>
      configs[input.id]?.enabled,
  );
  const targetTrials =
    Math.max(
      1,
      Math.floor(
        Number(targetTrialsRaw) || 1,
      ),
    );

  let continuousParameters = 0;
  let categoricalParameters = 0;
  let conditionalParameters = 0;
  let discreteCombinations = 1;
  let fullyDiscrete = true;
  const items: SearchSpaceAdviceItem[] = [];

  for (const input of enabled) {
    const config = configs[input.id];
    if (!config) continue;

    if (config.conditionParameter) {
      conditionalParameters += 1;

      const controller =
        configs[
          config.conditionParameter
        ];
      if (
        controller &&
        controller.choices.length > 0
      ) {
        const activeFraction =
          config.conditionValues.length /
          controller.choices.length;
        const expectedActive =
          targetTrials * activeFraction;

        if (
          activeFraction > 0 &&
          expectedActive < 20
        ) {
          items.push({
            severity: 'warning',
            title:
              input.label +
              ' may be under-sampled',
            detail:
              'Its condition is expected to be active in roughly ' +
              Math.round(activeFraction * 100) +
              '% of trials, giving only about ' +
              Math.round(expectedActive) +
              ' active trials at the current budget.',
          });
        }
      }
    }

    if (
      input.type === 'boolean' ||
      input.type === 'categorical'
    ) {
      categoricalParameters += 1;
      const count =
        config.choices.length;

      if (count >= 2) {
        discreteCombinations =
          capProduct(
            discreteCombinations,
            count,
          );
      }
      continue;
    }

    if (
      input.type !== 'integer' &&
      input.type !== 'float'
    ) {
      continue;
    }

    const low = finite(config.low);
    const high = finite(config.high);
    const step =
      automaticStep(input, config);

    if (
      low === null ||
      high === null ||
      low >= high
    ) {
      items.push({
        severity: 'warning',
        title:
          input.label +
          ' needs a valid range',
        detail:
          'Set a sensible minimum and maximum before starting the study.',
      });
      fullyDiscrete = false;
      continue;
    }

    if (
      typeof input.currentValue ===
        'number' &&
      (input.currentValue < low ||
        input.currentValue > high)
    ) {
      items.push({
        severity: 'warning',
        title:
          input.label +
          ' excludes the current value',
        detail:
          'The current TradingView value is outside the selected search range, so it cannot be used as the baseline for this parameter.',
      });
    }

    if (
      !config.log &&
      low > 0 &&
      high / low >= 100
    ) {
      items.push({
        severity: 'info',
        title:
          input.label +
          ' spans a very wide positive scale',
        detail:
          'The maximum is at least 100× the minimum. Consider logarithmic search if multiplicative differences are meaningful for this parameter.',
      });
    }

    const currentMagnitude =
      typeof input.currentValue ===
        'number'
        ? Math.max(
            Math.abs(input.currentValue),
            1,
          )
        : 1;
    if (
      Math.abs(high - low) /
        currentMagnitude >
      1_000
    ) {
      items.push({
        severity: 'warning',
        title:
          input.label +
          ' has an unusually broad range',
        detail:
          'The range is more than 1,000× the scale of the current value. Check that the limits are intentional rather than TradingView metadata or placeholder values.',
      });
    }

    if (
      input.type === 'float' &&
      step === null
    ) {
      continuousParameters += 1;
      fullyDiscrete = false;
      continue;
    }

    if (
      step !== null &&
      step > 0
    ) {
      const count =
        Math.floor(
          (high - low) / step,
        ) + 1;

      if (count > 0) {
        discreteCombinations =
          capProduct(
            discreteCombinations,
            count,
          );
      }
    } else {
      fullyDiscrete = false;
    }
  }

  const selectedParameters =
    enabled.length;
  const complexity =
    selectedParameters * 22 +
    continuousParameters * 35 +
    categoricalParameters * 12 +
    conditionalParameters * 18;

  let recommendedMinimum = Math.max(
    20,
    Math.round(40 + complexity),
  );

  if (
    fullyDiscrete &&
    discreteCombinations > 0
  ) {
    recommendedMinimum = Math.min(
      recommendedMinimum,
      discreteCombinations,
    );
  }

  const comfortable = Math.min(
    100_000,
    Math.max(
      recommendedMinimum,
      Math.round(
        recommendedMinimum * 1.75,
      ),
    ),
  );

  if (
    selectedParameters > 0 &&
    targetTrials < recommendedMinimum
  ) {
    items.unshift({
      severity: 'warning',
      title:
        'Trial budget looks thin for this search space',
      detail:
        'The current budget is ' +
        targetTrials +
        ' trials. A heuristic starting range is about ' +
        recommendedMinimum +
        '–' +
        comfortable +
        '. This is guidance, not a statistical guarantee.',
    });
  } else if (selectedParameters > 0) {
    items.unshift({
      severity: 'good',
      title:
        'Trial budget is reasonable for a first pass',
      detail:
        'The configured budget is within or above the heuristic range for the selected search-space complexity.',
    });
  }

  if (
    fullyDiscrete &&
    discreteCombinations > 0 &&
    targetTrials >= discreteCombinations
  ) {
    items.push({
      severity: 'info',
      title:
        'Trial budget can cover the whole discrete space',
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
    discreteCombinations:
      fullyDiscrete
        ? discreteCombinations
        : null,
    recommendedTrials: {
      minimum: recommendedMinimum,
      comfortable,
    },
    items,
  };
};
