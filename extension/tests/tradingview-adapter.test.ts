import { setImmediate } from 'node:timers';
import { describe, expect, it, spyOn, jest } from 'bun:test';

import type { CreateRun } from '../lib/protocol/types';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { TradingViewBridge } from '../lib/tradingview/bridge';
import type { TradingViewDiagnostics } from '../lib/tradingview/types';

const realSetImmediate = setImmediate;

const config: CreateRun = {
  run_id: 'run-context-test',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 10,
  parameters: [
    {
      type: 'int',
      name: 'in_0',
      low: 5,
      high: 20,
      step: 1,
    },
  ],
  filters: [],
  chart: {
    symbol: 'OANDA:XAUUSD',
    timeframe: '5',
    strategy_name: 'Strategy',
    strategy_signature: 'strategy-signature',
    strategy_settings_signature: 'settings-signature',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2024-01-01',
    end_date: '2024-12-31',
  },
};

describe('TradingView pre-flight compatibility', () => {
  const adapterFor = (diagnostics: TradingViewDiagnostics) =>
    new TradingViewAdapter({
      request: async (action: string, payload: unknown) => {
        expect(action).toBe('diagnostics');
        expect(payload).toEqual({ strategyId: 'strategy-1' });
        return diagnostics;
      },
    } as unknown as TradingViewBridge);

  it('accepts successful critical checks and ignores optional failures', async () => {
    const adapter = adapterFor({
      checks: [
        { id: 'chart-api', label: 'Chart API', ok: true },
        { id: 'strategy-signature', label: 'Strategy signature', ok: true },
        { id: 'trade-level-data', label: 'Closed trades', ok: false },
      ],
      deepBacktesting: { available: true, reason: null },
    });
    expect(await adapter.compatibilityFailureReason('strategy-1', config)).toBeNull();
  });

  it('combines critical and deep-backtesting failures', async () => {
    const adapter = adapterFor({
      checks: [{ id: 'metrics-readable', label: 'Metrics', ok: false, detail: 'report missing' }],
      deepBacktesting: { available: false, reason: 'not available' },
    });
    expect(await adapter.compatibilityFailureReason('strategy-1', config)).toBe(
      'Metrics: report missing; Deep Backtesting: not available',
    );
  });

  it('permits chart backtesting when Deep Backtesting is unavailable', async () => {
    const adapter = adapterFor({
      checks: [{ id: 'chart-api', label: 'Chart API', ok: true }],
      deepBacktesting: { available: false, reason: null },
    });
    expect(
      await adapter.compatibilityFailureReason('strategy-1', { ...config, backtest_range: null }),
    ).toBeNull();
    expect(await adapter.compatibilityFailureReason('strategy-1', config)).toBe(
      'Deep Backtesting: Unavailable',
    );
  });
});

describe('TradingView adapter run context', () => {
  it.each([true, false])(
    'uses the canonical Deep range and only caches verified dates (verified=%s)',
    async (verified) => {
      const calls: Array<{ action: string; payload: unknown; timeout: number | undefined }> = [];
      const range = config.backtest_range!;
      const bridge = {
        request: async (action: string, payload: unknown, timeout?: number) => {
          calls.push({ action, payload, timeout });
          switch (action) {
            case 'ensureStrategyTester':
              return true;
            case 'readReportPollSnapshot':
              return {
                metrics: { profitFactor: 2 },
                token: 'report',
                objectId: 1,
                metricSource: 'deep-visible',
                error: null,
              };
            case 'configureDeepBacktestRange':
            case 'refreshDeepBacktestReport':
              return { supported: true, applied: true, reason: null };
            case 'readReportSnapshot':
              return {
                backtestRange: verified
                  ? {
                      from: Date.parse(range.start_date + 'T00:00:00Z'),
                      to: Date.parse(range.end_date + 'T00:00:00Z'),
                    }
                  : null,
              };
            case 'applyParameters':
              return { confirmed: { in_0: 15 } };
            default:
              throw new Error('Unexpected bridge request: ' + action);
          }
        },
      } as unknown as TradingViewBridge;
      const adapter = new TradingViewAdapter(bridge);
      const wait = spyOn(adapter, 'waitForMetricsAfterChange').mockResolvedValue({
        profitFactor: 2,
      });
      await adapter.prepareBacktest('strategy-1', range);
      expect(await adapter.evaluateParameters('strategy-1', { in_0: 15 }, range)).toEqual({
        profitFactor: 2,
      });
      const configurations = calls.filter((call) => call.action === 'configureDeepBacktestRange');
      expect(configurations).toHaveLength(verified ? 1 : 2);
      expect(configurations[0]).toEqual({
        action: 'configureDeepBacktestRange',
        payload: { startDate: '2024-01-01', endDate: '2024-12-31' },
        timeout: 8_000,
      });
      expect(calls.filter((call) => call.action === 'refreshDeepBacktestReport')).toHaveLength(
        verified ? 1 : 0,
      );
      expect(wait).toHaveBeenCalledTimes(2);
    },
  );

  it('prepares chart backtesting without configuring or polling a Deep range', async () => {
    const actions: string[] = [];
    const adapter = new TradingViewAdapter({
      request: async (action: string) => {
        actions.push(action);
        if (action === 'ensureStrategyTester') return true;
        if (action === 'resetToChartSession') return { reset: true, changed: false };
        throw new Error('Unexpected bridge request: ' + action);
      },
    } as unknown as TradingViewBridge);
    await adapter.prepareBacktest('strategy-1', null);
    expect(actions).toEqual(['ensureStrategyTester', 'resetToChartSession']);
  });

  it('validates a run with one consolidated page-world request', async () => {
    const actions: string[] = [];
    const bridge = {
      request: async (action: string) => {
        actions.push(action);

        if (action !== 'getRunContextSnapshot') {
          throw new Error('Unexpected bridge request: ' + action);
        }

        return {
          symbol: 'OANDA:XAUUSD',
          timeframe: '5',
          strategySignature: 'strategy-signature',
          inputs: [
            {
              id: 'in_0',
              label: 'Length',
              type: 'integer',
              currentValue: 14,
            },
            {
              id: 'in_1',
              label: 'Fixed filter',
              type: 'boolean',
              currentValue: true,
            },
          ],
          backtestMode: 'deep',
          backtestRange: {
            from: Date.parse('2024-01-01T00:00:00Z'),
            to: Date.parse('2024-12-31T00:00:00Z'),
          },
          settingsSignature: 'settings-signature',
        };
      },
    } as unknown as TradingViewBridge;

    const adapter = new TradingViewAdapter(bridge);

    await adapter.assertRunContext('strategy-1', config, {
      in_0: 14,
      in_1: true,
    });

    expect(actions).toEqual(['getRunContextSnapshot']);
  });

  it('uses lightweight report snapshots in the trial polling hot path', async () => {
    jest.useFakeTimers();

    try {
      const actions: string[] = [];
      let pollReads = 0;

      const bridge = {
        request: async (action: string) => {
          actions.push(action);

          if (action === 'readReportPollSnapshot') {
            pollReads += 1;

            return pollReads === 1
              ? {
                  metrics: {
                    profitFactor: 1,
                  },
                  token: 'before',
                  objectId: 1,
                  metricSource: 'internal',
                  error: null,
                }
              : {
                  metrics: {
                    profitFactor: 2,
                  },
                  token: 'after',
                  objectId: 2,
                  metricSource: 'internal',
                  error: null,
                };
          }

          if (action === 'applyParameters') {
            return {
              confirmed: {
                in_0: 15,
              },
            };
          }

          if (action === 'readMetrics') {
            return {
              profitFactor: 2,
              'tv.all.netProfit': 123,
            };
          }

          throw new Error('Unexpected bridge request: ' + action);
        },
      } as unknown as TradingViewBridge;

      const adapter = new TradingViewAdapter(bridge);
      const controller = new AbortController();
      const add = spyOn(controller.signal, 'addEventListener');
      const remove = spyOn(controller.signal, 'removeEventListener');
      const evaluation = adapter.evaluateParameters(
        'strategy-1',
        { in_0: 15 },
        null,
        controller.signal,
      );

      await advanceTimersByTime(1_000);

      await expect(evaluation).resolves.toEqual({
        profitFactor: 2,
        'tv.all.netProfit': 123,
      });
      expect(actions).not.toContain('readReportSnapshot');
      expect(add.mock.calls.length).toBeGreaterThan(1);
      expect(remove.mock.calls).toHaveLength(add.mock.calls.length);
      expect(actions.filter((action) => action === 'readMetrics')).toHaveLength(1);
      expect(
        actions.filter((action) => action === 'readReportPollSnapshot').length,
      ).toBeGreaterThanOrEqual(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed when TradingView never publishes a new report revision', async () => {
    jest.useFakeTimers();

    try {
      const bridge = {
        request: async (action: string) => {
          if (action === 'readReportPollSnapshot') {
            return {
              metrics: {
                profitFactor: 1.2,
              },
              token: 'unchanged',
              objectId: 1,
              metricSource: 'internal',
              error: null,
            };
          }

          if (action === 'applyParameters') {
            return {
              confirmed: {
                in_0: 15,
              },
            };
          }

          if (action === 'ensureStrategyTester') {
            return true;
          }

          throw new Error('Unexpected bridge request: ' + action);
        },
      } as unknown as TradingViewBridge;

      const adapter = new TradingViewAdapter(bridge);
      const evaluation = adapter.evaluateParameters('strategy-1', { in_0: 15 }, null);

      // Observe the rejection before advancing timers, without invoking a blocking matcher.
      const outcome = evaluation.catch((error: unknown) => error);

      await advanceTimersByTime(66_000);

      expect(await outcome).toBeInstanceOf(Error);
      expect(await outcome).toHaveProperty(
        'message',
        expect.stringMatching(/ambiguous|recalculate/i),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('still rejects fixed-input changes from the consolidated snapshot', async () => {
    const bridge = {
      request: async () => ({
        symbol: 'OANDA:XAUUSD',
        timeframe: '5',
        strategySignature: 'strategy-signature',
        inputs: [
          {
            id: 'in_0',
            label: 'Length',
            type: 'integer',
            currentValue: 15,
          },
          {
            id: 'in_1',
            label: 'Fixed filter',
            type: 'boolean',
            currentValue: false,
          },
        ],
        backtestMode: 'deep',
        backtestRange: {
          from: Date.parse('2024-01-01T00:00:00Z'),
          to: Date.parse('2024-12-31T00:00:00Z'),
        },
        settingsSignature: 'settings-signature',
      }),
    } as unknown as TradingViewBridge;

    const adapter = new TradingViewAdapter(bridge);

    await expect(
      adapter.assertRunContext('strategy-1', config, {
        in_0: 14,
        in_1: true,
      }),
    ).rejects.toThrow(/Fixed strategy input/);
  });
});

// Drain promise continuations between polling ticks using an unfaked scheduler.
async function advanceTimersByTime(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
    jest.advanceTimersByTime(Math.min(100, ms - elapsed));
  }
  await new Promise<void>((resolve) => realSetImmediate(resolve));
}
