import type { BacktestRange } from '../protocol/types';
import type {
  ClosedTrade,
  ClosedTradeSnapshot,
} from '../tradingview/trades';

export interface MonteCarloInterval {
  low: number;
  median: number;
  high: number;
}

export interface MonteCarloResult {
  available: boolean;
  source: 'oos' | 'optimisation';
  range: BacktestRange | null;
  reason: string | null;
  sampleSize: number;
  simulations: number;
  confidence: number;
  unit: 'percent' | 'pnl';
  probabilityOfLoss: number | null;
  total: MonteCarloInterval | null;
  maxDrawdown: {
    median: number;
    p95: number;
  } | null;
  profitFactor:
    | MonteCarloInterval
    | null;
}

const hashTrades = (
  trades: ClosedTrade[],
): number => {
  let hash = 2166136261;

  for (const trade of trades) {
    for (const value of [
      trade.pnl,
      trade.pnlPercent ?? 0,
    ]) {
      const text = value.toPrecision(12);
      for (
        let index = 0;
        index < text.length;
        index += 1
      ) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(
          hash,
          16777619,
        );
      }
    }
  }

  return hash >>> 0;
};

const mulberry32 = (
  seed: number,
): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(
      value ^ (value >>> 15),
      value | 1,
    );
    value ^=
      value +
      Math.imul(
        value ^ (value >>> 7),
        value | 61,
      );

    return (
      ((value ^ (value >>> 14)) >>> 0) /
      4294967296
    );
  };
};

const quantile = (
  sorted: number[],
  probability: number,
): number | null => {
  if (sorted.length === 0) {
    return null;
  }

  const position =
    (sorted.length - 1) *
    Math.min(
      1,
      Math.max(0, probability),
    );
  const lowerIndex =
    Math.floor(position);
  const upperIndex =
    Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (
    lower === undefined ||
    upper === undefined
  ) {
    return null;
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return (
    lower +
    (upper - lower) *
      (position - lowerIndex)
  );
};

const interval = (
  values: number[],
  confidence: number,
): MonteCarloInterval | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort(
    (left, right) => left - right,
  );
  const tail =
    (1 - confidence) / 2;
  const low = quantile(
    sorted,
    tail,
  );
  const median = quantile(
    sorted,
    0.5,
  );
  const high = quantile(
    sorted,
    1 - tail,
  );

  if (
    low === null ||
    median === null ||
    high === null
  ) {
    return null;
  }

  return {
    low,
    median,
    high,
  };
};

const chooseValues = (
  trades: ClosedTrade[],
): {
  values: number[];
  unit: 'percent' | 'pnl';
} => {
  const percentages = trades.map(
    (trade) => trade.pnlPercent,
  );

  if (
    percentages.every(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value),
    )
  ) {
    return {
      values: percentages,
      unit: 'percent',
    };
  }

  return {
    values: trades.map(
      (trade) => trade.pnl,
    ),
    unit: 'pnl',
  };
};

export const runTradeMonteCarlo = (
  snapshot: ClosedTradeSnapshot,
  simulations: number,
  confidence: number,
  context: {
    source: 'oos' | 'optimisation';
    range: BacktestRange | null;
  },
): MonteCarloResult => {
  if (
    !snapshot.available ||
    snapshot.trades.length < 2
  ) {
    return {
      available: false,
      source: context.source,
      range: context.range,
      reason:
        snapshot.reason ??
        'Closed-trade data is unavailable.',
      sampleSize:
        snapshot.trades.length,
      simulations,
      confidence,
      unit: 'pnl',
      probabilityOfLoss: null,
      total: null,
      maxDrawdown: null,
      profitFactor: null,
    };
  }

  const { values, unit } =
    chooseValues(snapshot.trades);
  const rng = mulberry32(
    hashTrades(snapshot.trades),
  );
  const totals: number[] = [];
  const drawdowns: number[] = [];
  const profitFactors: number[] = [];
  let losingSimulations = 0;

  for (
    let simulation = 0;
    simulation < simulations;
    simulation += 1
  ) {
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (
      let tradeIndex = 0;
      tradeIndex < values.length;
      tradeIndex += 1
    ) {
      const sampled =
        values[
          Math.floor(
            rng() * values.length,
          )
        ];

      if (sampled === undefined) {
        continue;
      }

      cumulative += sampled;
      peak = Math.max(
        peak,
        cumulative,
      );
      maxDrawdown = Math.max(
        maxDrawdown,
        peak - cumulative,
      );

      if (sampled > 0) {
        grossProfit += sampled;
      } else if (sampled < 0) {
        grossLoss += -sampled;
      }
    }

    totals.push(cumulative);
    drawdowns.push(maxDrawdown);

    if (cumulative < 0) {
      losingSimulations += 1;
    }

    if (grossLoss > 0) {
      profitFactors.push(
        grossProfit / grossLoss,
      );
    }
  }

  const sortedDrawdowns = [
    ...drawdowns,
  ].sort(
    (left, right) => left - right,
  );

  const drawdownMedian =
    quantile(
      sortedDrawdowns,
      0.5,
    );
  const drawdownP95 =
    quantile(
      sortedDrawdowns,
      0.95,
    );

  return {
    available: true,
    source: context.source,
    range: context.range,
    reason: null,
    sampleSize: values.length,
    simulations,
    confidence,
    unit,
    probabilityOfLoss:
      losingSimulations /
      simulations,
    total: interval(
      totals,
      confidence,
    ),
    maxDrawdown:
      drawdownMedian === null ||
      drawdownP95 === null
        ? null
        : {
            median:
              drawdownMedian,
            p95:
              drawdownP95,
          },
    profitFactor: interval(
      profitFactors,
      confidence,
    ),
  };
};
