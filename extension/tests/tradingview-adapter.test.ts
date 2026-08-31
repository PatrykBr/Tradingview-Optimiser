import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  CreateRun,
} from '../lib/protocol/types';
import {
  TradingViewAdapter,
} from '../lib/tradingview/adapter';
import type {
  TradingViewBridge,
} from '../lib/tradingview/bridge';

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
    strategy_settings_signature:
      'settings-signature',
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
      request: async (
        action: string,
      ) => {
        actions.push(action);

        if (
          action !==
          'getRunContextSnapshot'
        ) {
          throw new Error(
            'Unexpected bridge request: ' +
              action,
          );
        }

        return {
          symbol: 'OANDA:XAUUSD',
          timeframe: '5',
          strategySignature:
            'strategy-signature',
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
            from: Date.parse(
              '2024-01-01T00:00:00Z',
            ),
            to: Date.parse(
              '2024-12-31T00:00:00Z',
            ),
          },
          settingsSignature:
            'settings-signature',
        };
      },
    } as unknown as TradingViewBridge;

    const adapter =
      new TradingViewAdapter(bridge);

    await adapter.assertRunContext(
      'strategy-1',
      config,
      {
        in_0: 14,
        in_1: true,
      },
    );

    expect(actions).toEqual([
      'getRunContextSnapshot',
    ]);
  });

  it('still rejects fixed-input changes from the consolidated snapshot', async () => {
    const bridge = {
      request: async () => ({
        symbol: 'OANDA:XAUUSD',
        timeframe: '5',
        strategySignature:
          'strategy-signature',
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
          from: Date.parse(
            '2024-01-01T00:00:00Z',
          ),
          to: Date.parse(
            '2024-12-31T00:00:00Z',
          ),
        },
        settingsSignature:
          'settings-signature',
      }),
    } as unknown as TradingViewBridge;

    const adapter =
      new TradingViewAdapter(bridge);

    await expect(
      adapter.assertRunContext(
        'strategy-1',
        config,
        {
          in_0: 14,
          in_1: true,
        },
      ),
    ).rejects.toThrow(
      /Fixed strategy input/,
    );
  });
});
