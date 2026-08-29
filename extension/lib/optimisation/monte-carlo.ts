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
  unit: 'pnl';
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

3260