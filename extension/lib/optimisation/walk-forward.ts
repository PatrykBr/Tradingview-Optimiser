import type {
  BacktestRange,
  ObjectiveDirection,
  SearchParameter,
} from '../protocol/types';
import { median } from './research';
import { DAY_MS, formatDate, parseDate } from './dates';

export interface WalkForwardFold {
  index: number;
  trainingRange: BacktestRange;
  testRange: BacktestRange;
}

export interface WalkForwardFoldResult {
  fold: WalkForwardFold;
  runId: string;
  completedTrials: number;
  bestParameters:
    Record<string, unknown> | null;
  inSampleObjective: number | null;
  testObjective: number | null;
  passedFilters: boolean;
}

export type ParameterConsistency =
  | 'stable'
  | 'variable'
  | 'insufficient';

export interface WalkForwardResult {
  folds: WalkForwardFoldResult[];
  passedFolds: number;
  totalFolds: number;
  medianTestObjective: number | null;
  worstTestObjective: number | null;
  parameterConsistency: Record<
    string,
    ParameterConsistency
  >;
}

export const buildWalkForwardPlan = (
  fullRange: BacktestRange,
  folds: number,
  initialTrainingFraction: number,
): WalkForwardFold[] => {
  const start = parseDate(
    fullRange.start_date,
  );
  const end = parseDate(
    fullRange.end_date,
  );
  const totalDays =
    Math.floor(
      (end - start) / DAY_MS,
    ) + 1;

  if (totalDays < folds * 2 + 10) {
    throw new Error(
      'Deep Backtesting range is too short for the selected walk-forward folds',
    );
  }

  const initialTrainingDays =
    Math.max(
      5,
      Math.floor(
        totalDays *
          initialTrainingFraction,
      ),
    );
  const remainingDays =
    totalDays -
    initialTrainingDays;

  if (remainingDays < folds * 2) {
    throw new Error(
      'Walk-forward initial training window leaves too little unseen data',
    );
  }

  const result: WalkForwardFold[] = [];
  let testStart =
    start +
    initialTrainingDays * DAY_MS;

  for (
    let index = 0;
    index < folds;
    index += 1
  ) {
    const remainingFolds =
      folds - index;
    const remainingTestDays =
      Math.floor(
        (end - testStart) / DAY_MS,
      ) + 1;
    const testDays =
      Math.max(
        1,
        Math.floor(
          remainingTestDays /
            remainingFolds,
        ),
      );
    const testEnd =
      index === folds - 1
        ? end
        : testStart +
          (testDays - 1) * DAY_MS;
    const trainingEnd =
      testStart - DAY_MS;

    result.push({
      index,
      trainingRange: {
        mode: 'deep',
        start_date:
          fullRange.start_date,
        end_date:
          formatDate(trainingEnd),
      },
      testRange: {
        mode: 'deep',
        start_date:
          formatDate(testStart),
        end_date:
          formatDate(testEnd),
      },
    });

    testStart =
      testEnd + DAY_MS;
  }

  return result;
};

const consistencyFor = (
  values: unknown[],
  parameter: SearchParameter,
): ParameterConsistency => {
  if (values.length < 2) {
    return 'insufficient';
  }

  if (
    parameter.type === 'categorical'
  ) {
    const unique =
      new Set(
        values.map((value) =>
          JSON.stringify(value),
        ),
      ).size;

    return unique <=
      Math.max(
        1,
        Math.ceil(values.length / 3),
      )
      ? 'stable'
      : 'variable';
  }

  const numbers = values.filter(
    (value): value is number =>
      typeof value === 'number' &&
      Number.isFinite(value),
  );

  if (numbers.length < 2) {
    return 'insufficient';
  }

  const spread =
    Math.max(...numbers) -
    Math.min(...numbers);
  const searchWidth =
    parameter.high -
    parameter.low;

  if (searchWidth <= 0) {
    return 'insufficient';
  }

  return spread / searchWidth <= 0.25
    ? 'stable'
    : 'variable';
};

export const summariseWalkForward = (
  folds: WalkForwardFoldResult[],
  parameters: SearchParameter[],
  direction: ObjectiveDirection,
): WalkForwardResult => {
  const testValues = folds
    .map((fold) => fold.testObjective)
    .filter(
      (value): value is number =>
        value !== null,
    );

  const parameterConsistency: Record<
    string,
    ParameterConsistency
  > = {};

  for (const parameter of parameters) {
    const values = folds
      .map(
        (fold) =>
          fold.bestParameters?.[
            parameter.name
          ],
      )
      .filter(
        (value) =>
          value !== undefined,
      );

    parameterConsistency[
      parameter.name
    ] = consistencyFor(
      values,
      parameter,
    );
  }

  return {
    folds,
    passedFolds: folds.filter(
      (fold) =>
        fold.passedFilters,
    ).length,
    totalFolds: folds.length,
    medianTestObjective:
      median(testValues),
    worstTestObjective:
      testValues.length === 0
        ? null
        : direction === 'maximize'
          ? Math.min(
              ...testValues,
            )
          : Math.max(
              ...testValues,
            ),
    parameterConsistency,
  };
};
