import { setImmediate } from 'node:timers';
import { describe, expect, it, spyOn, jest } from 'bun:test';

import type { CreateRun } from '../lib/protocol/types';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { TradingViewBridge } from '../lib/tradingview/bridge';

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

describe('TradingView adapter run context', () => {
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
      expect(remove.mock.calls.length).toBe(add.mock.calls.length);
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
