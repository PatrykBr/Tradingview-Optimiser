import { asRecord, type UnknownRecord } from './parsers';

export interface ClosedTrade {
  pnl: number;
  pnlPercent?: number;
}

export interface ClosedTradeSnapshot {
  available: boolean;
  trades: ClosedTrade[];
  reason: string | null;
}

const PNL_KEYS = ['profit', 'profitLoss', 'profit_loss', 'pnl', 'netProfit', 'net_profit', 'pl'];

const PERCENT_KEYS = [
  'profitPercent',
  'profit_percent',
  'pnlPercent',
  'pnl_percent',
  'returnPercent',
  'return_percent',
];

const TRADE_CONTAINER_KEYS = [
  'trades',
  'tradeList',
  'trade_list',
  'listOfTrades',
  'closedTrades',
  'closed_trades',
  'tradesList',
  'trades_list',
];

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const firstNumeric = (record: UnknownRecord, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const parseTrade = (value: unknown): ClosedTrade | null => {
  const record = asRecord(value);
  const pnl = firstNumeric(record, PNL_KEYS);

  if (pnl === undefined) {
    return null;
  }

  const pnlPercent = firstNumeric(record, PERCENT_KEYS);

  return pnlPercent === undefined ? { pnl } : { pnl, pnlPercent };
};

const candidateArrays = (value: unknown): unknown[][] => {
  const root = asRecord(value);
  const arrays: unknown[][] = [];
  const queue: Array<{
    record: UnknownRecord;
    depth: number;
  }> = [{ record: root, depth: 0 }];
  const seen = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (seen.has(current.record) || current.depth > 4) {
      continue;
    }
    seen.add(current.record);

    for (const [key, child] of Object.entries(current.record)) {
      if (TRADE_CONTAINER_KEYS.includes(key) && Array.isArray(child)) {
        arrays.push(child);
        continue;
      }

      if (/trade/i.test(key) && child && typeof child === 'object') {
        if (Array.isArray(child)) {
          arrays.push(child);
        } else {
          queue.push({
            record: asRecord(child),
            depth: current.depth + 1,
          });
        }
        continue;
      }

      if (child && typeof child === 'object' && !Array.isArray(child) && current.depth < 2) {
        queue.push({
          record: asRecord(child),
          depth: current.depth + 1,
        });
      }
    }
  }

  return arrays;
};

export const extractClosedTrades = (report: unknown): ClosedTradeSnapshot => {
  let best: ClosedTrade[] = [];

  for (const candidate of candidateArrays(report)) {
    const trades = candidate
      .map(parseTrade)
      .filter((trade): trade is ClosedTrade => trade !== null);

    if (trades.length > best.length) {
      best = trades;
    }
  }

  if (best.length < 2) {
    return {
      available: false,
      trades: [],
      reason: 'TradingView did not expose a recognised closed-trade list in this report build.',
    };
  }

  return {
    available: true,
    trades: best,
    reason: null,
  };
};
