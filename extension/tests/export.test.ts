import { describe, expect, it } from 'bun:test';

import { buildRunExport, buildRunJson, buildTrialsCsv } from '../lib/optimisation/export';
import type { CreateRun, RunProgress } from '../lib/protocol/types';

const config: CreateRun = {
  run_id: '12345678-test-run',
  objective_metric: 'profitFactor',
  direction: 'maximize',
  target_trials: 2,
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
    strategy_name: 'Strategy "A"',
    strategy_signature: 'abc123',
  },
  backtest_range: {
    mode: 'deep',
    start_date: '2024-01-01',
    end_date: '2025-01-01',
  },
};

const progress: RunProgress = {
  run_id: config.run_id,
  status: 'completed',
  completed_trials: 2,
  target_trials: 2,
  failed_trials: 0,
  reused_trials: 1,
  best: {
    trial_number: 0,
    objective_value: 1.8,
    parameters: { in_0: 14 },
    metrics: { profitFactor: 1.8, totalTrades: 100 },
    constraints: {},
  },
  trials: [
    {
      trial_number: 0,
      state: 'complete',
      objective_value: 1.8,
      parameters: { in_0: 14 },
      metrics: { profitFactor: 1.8, totalTrades: 100 },
      constraints: {},
      failure_reason: null,
      duration_ms: 1250,
      reused_from_trial: null,
    },
    {
      trial_number: 1,
      state: 'complete',
      objective_value: 1.8,
      parameters: { in_0: 14 },
      metrics: { profitFactor: 1.8, totalTrades: 100 },
      constraints: {},
      failure_reason: null,
      duration_ms: null,
      reused_from_trial: 0,
    },
  ],
};

describe('run export', () => {
  it('exports flattened CSV with metadata', () => {
    const csv = buildTrialsCsv(config, progress);
    expect(csv).toContain('"Strategy ""A"""');
    expect(csv).toContain('"param:in_0"');
    expect(csv).toContain('"metric:profitFactor"');
    expect(csv).toContain('"reused_from_trial"');
    expect(csv).toContain('"14"');
    expect(csv).toContain('"1","complete","1.8","","0"');
  });

  it('builds a complete downloadable export payload', () => {
    const payload = buildRunExport(config, progress, 'csv');

    expect(payload.filename).toBe('Strategy-A-12345678.csv');
    expect(payload.mimeType).toBe('text/csv');
    expect(payload.content).toContain('"reused_from_trial"');
  });

  it('exports complete JSON', () => {
    const json = JSON.parse(buildRunJson(config, progress));
    expect(json.config.run_id).toBe(config.run_id);
    expect(json.progress.trials[0].metrics.profitFactor).toBe(1.8);
    expect(typeof json.exported_at).toBe('string');
  });
});
