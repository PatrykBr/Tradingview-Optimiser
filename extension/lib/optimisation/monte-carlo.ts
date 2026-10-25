import { forEachSequential } from '../async';
import type { BacktestRange } from '../protocol/types';
import type { ClosedTrade, ClosedTradeSnapshot } from '../tradingview/trades';

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
  profitFactor: MonteCarloInterval | null;
}

interface MonteCarloContext {
  source: 'oos' | 'optimisation';
  range: BacktestRange | null;
}

const hashTrades = (trades: ClosedTrade[]): number => {
  let hash = 2166136261;

  for (const trade of trades) {
    for (const value of [trade.pnl, trade.pnlPercent ?? 0]) {
      const text = value.toPrecision(12);
      for (const character of text) {
        hash ^= character.codePointAt(0)!;
        hash = Math.imul(hash, 16777619);
      }
    }
  }

  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const quantile = (sorted: number[], probability: number): number | null => {
  if (sorted.length === 0) {
    return null;
  }

  const position = (sorted.length - 1) * Math.min(1, Math.max(0, probability));
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (position - lowerIndex);
};

const interval = (values: number[], confidence: number): MonteCarloInterval | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const tail = (1 - confidence) / 2;
  const low = quantile(sorted, tail);
  const median = quantile(sorted, 0.5);
  const high = quantile(sorted, 1 - tail);

  if (low === null || median === null || high === null) {
    return null;
  }

  return {
    low,
    median,
    high,
  };
};

const unavailable = (
  snapshot: ClosedTradeSnapshot,
  simulations: number,
  confidence: number,
  context: MonteCarloContext,
  reason?: string,
): MonteCarloResult => ({
  available: false,
  source: context.source,
  range: context.range,
  reason: reason ?? snapshot.reason ?? 'Trade-level data is unavailable.',
  sampleSize: 0,
  simulations,
  confidence,
  unit: 'pnl',
  probabilityOfLoss: null,
  total: null,
  maxDrawdown: null,
  profitFactor: null,
});

const finiteTrades = (snapshot: ClosedTradeSnapshot): ClosedTrade[] =>
  snapshot.trades.filter((trade) => Number.isFinite(trade.pnl));

const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const simulateTrades = (trades: ClosedTrade[], random: () => number) => {
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let remaining = trades.length; remaining > 0; remaining -= 1) {
    const sampledIndex = Math.min(trades.length - 1, Math.floor(random() * trades.length));
    const sampledTrade = trades[sampledIndex];

    if (!sampledTrade) continue;

    const pnl = sampledTrade.pnl;
    cumulativePnl += pnl;

    if (cumulativePnl > peakPnl) {
      peakPnl = cumulativePnl;
    }

    maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);

    if (pnl > 0) {
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
    }
  }
  return { cumulativePnl, maxDrawdown, grossProfit, grossLoss };
};

export const runTradeMonteCarlo = async (
  snapshot: ClosedTradeSnapshot,
  requestedSimulations: number,
  requestedConfidence: number,
  context: MonteCarloContext,
  signal?: AbortSignal,
): Promise<MonteCarloResult> => {
  const simulations = Math.max(
    1,
    Math.floor(Number.isFinite(requestedSimulations) ? requestedSimulations : 1),
  );
  const confidence = Math.min(
    0.99,
    Math.max(0.5, Number.isFinite(requestedConfidence) ? requestedConfidence : 0.9),
  );

  if (!snapshot.available) {
    return unavailable(snapshot, simulations, confidence, context);
  }

  const trades = finiteTrades(snapshot);
  if (trades.length < 2) {
    return unavailable(
      snapshot,
      simulations,
      confidence,
      context,
      'At least two finite closed trades are required for Monte Carlo analysis.',
    );
  }

  const seed =
    hashTrades(trades) ^ Math.imul(simulations, 0x9e3779b1) ^ Math.round(confidence * 1_000_000);
  const random = mulberry32(seed);

  const totals: number[] = [];
  const drawdowns: number[] = [];
  const profitFactors: number[] = [];
  let losingSimulations = 0;

  const batchStarts = Array.from(
    { length: Math.ceil(simulations / 250) },
    (_, index) => index * 250,
  );
  await forEachSequential(batchStarts, async (start) => {
    const end = Math.min(simulations, start + 250);
    for (let simulation = start; simulation < end; simulation += 1) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      const { cumulativePnl, maxDrawdown, grossProfit, grossLoss } = simulateTrades(trades, random);

      totals.push(cumulativePnl);
      drawdowns.push(maxDrawdown);

      if (cumulativePnl < 0) {
        losingSimulations += 1;
      }

      if (grossLoss > 0) {
        profitFactors.push(grossProfit / grossLoss);
      }
    }
    if (end < simulations) await yieldToBrowser();
  });

  const sortedDrawdowns = [...drawdowns].sort((left, right) => left - right);
  const medianDrawdown = quantile(sortedDrawdowns, 0.5);
  const p95Drawdown = quantile(sortedDrawdowns, 0.95);

  return {
    available: true,
    source: context.source,
    range: context.range,
    reason: null,
    sampleSize: trades.length,
    simulations,
    confidence,
    unit: 'pnl',
    probabilityOfLoss: losingSimulations / simulations,
    total: interval(totals, confidence),
    maxDrawdown:
      medianDrawdown === null || p95Drawdown === null
        ? null
        : {
            median: medianDrawdown,
            p95: p95Drawdown,
          },
    profitFactor: interval(profitFactors, confidence),
  };
};
