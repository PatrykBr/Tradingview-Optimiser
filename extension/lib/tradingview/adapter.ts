import { TradingViewBridge } from './bridge';
import type { DetectedStrategy, StrategyInput, TradingViewMetrics } from './types';

interface ApplyParametersResult {
  confirmed: Record<string, unknown>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operation aborted', 'AbortError'));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('Operation aborted', 'AbortError'));
      },
      { once: true },
    );
  });

const metricsFingerprint = (
  metrics: TradingViewMetrics | null,
): string | null => {
  if (!metrics) return null;

  const stableKeys = [
    'netProfit',
    'netProfitPercent',
    'profitFactor',
    'maxDrawdownPercent',
    'totalTrades',
    'sharpeRatio',
    'sortinoRatio',
  ];

  return JSON.stringify(
    stableKeys.map((key) => metrics[key] ?? null),
  );
};

export class TradingViewAdapter {
  constructor(private readonly bridge: TradingViewBridge) {}

  detectStrategies(): Promise<DetectedStrategy[]> {
    return this.bridge.request<DetectedStrategy[]>('detectStrategies');
  }

  readStrategyInputs(strategyId: string): Promise<StrategyInput[]> {
    return this.bridge.request<StrategyInput[]>('readStrategyInputs', {
      strategyId,
    });
  }

  async applyParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.bridge.request<ApplyParametersResult>(
      'applyParameters',
      {
        strategyId,
        parameters,
      },
    );
    return result.confirmed;
  }

  readMetrics(strategyId: string): Promise<TradingViewMetrics | null> {
    return this.bridge.request<TradingViewMetrics | null>('readMetrics', {
      strategyId,
    });
  }

  async ensureStrategyTester(): Promise<void> {
    await this.bridge.request<boolean>('ensureStrategyTester');
  }

  async waitForMetricsAfterChange(
    strategyId: string,
    before: TradingViewMetrics | null,
    signal?: AbortSignal,
    timeoutMs = 20_000,
  ): Promise<TradingViewMetrics> {
    const startedAt = Date.now();
    const beforeFingerprint = metricsFingerprint(before);
    let lastFingerprint: string | null = null;
    let stableReads = 0;
    let sawChange = beforeFingerprint === null;

    // Give TradingView a short window to invalidate/recalculate the report
    // before we start accepting a stable result.
    await sleep(600, signal);

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      const metrics = await this.readMetrics(strategyId);
      const fingerprint = metricsFingerprint(metrics);

      if (fingerprint === null) {
        sawChange = true;
        stableReads = 0;
        lastFingerprint = null;
        await sleep(300, signal);
        continue;
      }

      if (fingerprint !== beforeFingerprint) sawChange = true;

      if (fingerprint === lastFingerprint) {
        stableReads += 1;
      } else {
        lastFingerprint = fingerprint;
        stableReads = 1;
      }

      const elapsed = Date.now() - startedAt;

      // Normal path: report changed and then remained stable.
      if (metrics && sawChange && stableReads >= 3 && elapsed >= 1_200) {
        return metrics;
      }

      // Some parameter changes can legitimately produce exactly the same
      // Strategy Tester metrics. After a longer grace period, accept a report
      // that remained stable rather than timing out forever.
      if (metrics && !sawChange && stableReads >= 4 && elapsed >= 3_500) {
        return metrics;
      }

      await sleep(300, signal);
    }

    throw new Error(
      'Timed out waiting for TradingView Strategy Tester to recalculate',
    );
  }

  getChartContext(): Promise<{ symbol: string; timeframe: string }> {
    return this.bridge.request<{ symbol: string; timeframe: string }>('getChartContext');
  }
}
