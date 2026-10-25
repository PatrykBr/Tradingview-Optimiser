import { describe, expect, it } from 'bun:test';

import {
  runAuxiliaryStudy,
  type AuxiliaryStudyTransport,
} from '../lib/optimisation/auxiliary-study-runner';
import type { BackgroundMessage, ExtensionRequest } from '../lib/messages';
import type { CreateRun } from '../lib/protocol/types';
import type { OptimisationTrialAdapter } from '../lib/optimisation/study-trial-runner';

const config: CreateRun = {
  run_id: 'aux-run',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 1,
  parameters: [
    {
      type: 'int',
      name: 'length',
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
    strategy_signature: 'sig',
  },
};

class FakeTransport implements AuxiliaryStudyTransport {
  readonly requests: ExtensionRequest[] = [];
  readonly listeners = new Set<(message: BackgroundMessage) => void>();

  async request(request: ExtensionRequest): Promise<unknown> {
    this.requests.push(request);

    if (request.type === 'START_RUN') {
      queueMicrotask(() => {
        this.emit({
          type: 'NEXT_TRIAL',
          trial: {
            run_id: config.run_id,
            trial_number: 0,
            parameters: {
              length: 14,
            },
          },
        });
      });
    }

    if (request.type === 'TRIAL_RESULT') {
      queueMicrotask(() => {
        this.emit({
          type: 'RUN_UPDATE',
          update: {
            run_id: config.run_id,
            status: 'completed',
            completed_trials: 1,
            target_trials: 1,
            failed_trials: 0,
            reused_trials: 0,
            best: {
              trial_number: 0,
              objective_value: 1.7,
              parameters: {
                length: 14,
              },
              metrics: {
                profitFactor: 1.7,
              },
              constraints: {},
            },
            termination_reason: 'target_trials',
            trial_updates: [
              {
                trial_number: 0,
                state: 'complete',
                objective_value: 1.7,
                parameters: {
                  length: 14,
                },
                metrics: {
                  profitFactor: 1.7,
                  totalTrades: 100,
                },
                constraints: {},
                failure_reason: null,
                duration_ms: 1,
                reused_from_trial: null,
              },
            ],
          },
        });
      });
    }

    return undefined;
  }

  subscribe(listener: (message: BackgroundMessage) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(message: BackgroundMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

class FakeAdapter implements OptimisationTrialAdapter {
  evaluations = 0;
  assertions = 0;

  async assertRunContext(): Promise<void> {
    this.assertions += 1;
  }

  async evaluateParameters(): Promise<Record<string, number>> {
    this.evaluations += 1;

    return {
      profitFactor: 1.7,
      totalTrades: 100,
    };
  }
}

describe('auxiliary study runner', () => {
  it('attempts every cleanup step and preserves start and cleanup failures', async () => {
    const requests: string[] = [];
    let unsubscribed = false;
    const transport: AuxiliaryStudyTransport = {
      async request(message) {
        requests.push(message.type);
        if (message.type === 'START_RUN') throw new Error('start failed');
        if (message.type === 'ABORT_RUN') throw new Error('abort failed');
        if (message.type === 'DELETE_RUN') throw new Error('delete failed');
      },
      subscribe() {
        return () => {
          unsubscribed = true;
        };
      },
    };
    await expect(
      runAuxiliaryStudy({
        transport,
        adapter: new FakeAdapter(),
        strategyId: 'strategy-1',
        config,
        originalParameters: null,
      }),
    ).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      message: expect.stringContaining('start failed'),
    });
    expect(requests).toEqual([
      'CREATE_RUN',
      'START_RUN',
      'ABORT_RUN',
      'DELETE_RUN',
      'CLEAR_RUN_OWNER',
    ]);
    expect(unsubscribed).toBe(true);
  });

  it('runs a temporary study through the shared trial runner and cleans it up', async () => {
    const transport = new FakeTransport();
    const adapter = new FakeAdapter();

    const progress = await runAuxiliaryStudy({
      transport,
      adapter,
      strategyId: 'strategy-1',
      config,
      originalParameters: {
        length: 14,
      },
    });

    expect(progress.status).toBe('completed');
    expect(adapter.evaluations).toBe(1);
    expect(adapter.assertions).toBe(2);
    expect(transport.requests.map((request) => request.type)).toEqual([
      'CREATE_RUN',
      'START_RUN',
      'TRIAL_RESULT',
      'ABORT_RUN',
      'DELETE_RUN',
      'CLEAR_RUN_OWNER',
    ]);
    expect(transport.listeners.size).toBe(0);
  });
});
