import { describe, expect, it } from 'bun:test';

import {
  compatibilityFailureReason,
  type CompatibilityAdapter,
} from '../lib/optimisation/run-compatibility';
import type { CreateRun } from '../lib/protocol/types';
import type { TradingViewDiagnostics } from '../lib/tradingview/types';

const config: CreateRun = {
  run_id: 'run-1',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 10,
  parameters: [],
  filters: [],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'sig',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2024-01-01',
    end_date: '2025-01-01',
  },
};

const adapterFor = (diagnostics: TradingViewDiagnostics): CompatibilityAdapter => ({
  diagnostics: async () => diagnostics,
});

describe('run compatibility', () => {
  it('returns null when all critical checks pass', async () => {
    const reason = await compatibilityFailureReason(
      adapterFor({
        checks: [
          {
            id: 'chart-api',
            label: 'Chart API',
            ok: true,
          },
          {
            id: 'strategy-signature',
            label: 'Strategy signature',
            ok: true,
          },
        ],
        deepBacktesting: {
          available: true,
          reason: null,
        },
      }),
      'strategy-1',
      config,
    );

    expect(reason).toBeNull();
  });

  it('combines critical and deep-backtesting failures', async () => {
    const reason = await compatibilityFailureReason(
      adapterFor({
        checks: [
          {
            id: 'metrics-readable',
            label: 'Metrics',
            ok: false,
            detail: 'report missing',
          },
          {
            id: 'optional-check',
            label: 'Optional',
            ok: false,
          },
        ],
        deepBacktesting: {
          available: false,
          reason: 'not available',
        },
      }),
      'strategy-1',
      config,
    );

    expect(reason).toBe('Metrics: report missing; Deep Backtesting: not available');
  });
});
