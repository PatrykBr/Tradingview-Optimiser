export interface NumericRangeInput {
  currentValue: number;
  min: number;
  max: number;
  step: number;
}

export interface NumericRangeOutput {
  min: number;
  max: number;
  step: number;
}

export function normalizeNumericRange(input: NumericRangeInput): NumericRangeOutput {
  const { currentValue } = input;
  let { min, max, step } = input;

  if (min >= max) {
    if (min === max) {
      min = min === 0 ? -10 : Math.floor(min * 0.5);
      max = currentValue === 0 ? 10 : Math.ceil(currentValue * 2);
    } else {
      [min, max] = [max, min];
    }
  }

  if (step <= 0) {
    step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.1;
  }

  return { min, max, step };
}
