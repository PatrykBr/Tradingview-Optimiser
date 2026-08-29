import { TradingViewBridge } from './bridge';
import type {
  DeepBacktestResult,
  DetectedStrategy,
  StrategyInput,
  TradingViewDiagnostics,
  TradingViewMetrics,
  TradingViewReportSnapshot,
} from './types';

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

  readReportSnapshot(
    strategyId: string,
  ): Promise<TradingViewReportSnapshot> {
    return this.bridge.request<TradingViewReportSnapshot>(
      'readReportSnapshot',
      { strategyId },
    );
  }

  getStrategySignature(strategyId: string): Promise<string> {
    return this.bridge.request<string>('getStrategySignature', {
      strategyId,
    });
  }

  diagnostics(
    strategyId?: string,
  ): Promise<TradingViewDiagnostics> {
    return this.bridge.request<TradingViewDiagnostics>('diagnostics', {
      ...(strategyId ? { strategyId } : {}),
    });
  }

  async resetToChartSession(): Promise<void> {
    await this.bridge.request<{ reset: boolean; changed: boolean }>(
      'resetToChartSession',
      undefined,
      5_000,
    );
  }

  configureDeepBacktestRange(
    startDate: string,
    endDate: string,
  ): Promise<DeepBacktestResult> {
    return this.bridge.request<DeepBacktestResult>(
      'configureDeepBacktestRange',
      { startDate, endDate },
      8_000,
    );
  }

  async ensureStrategyTester(): Promise<void> {
    const opened = await this.bridge.request<boolean>(
      'ensureStrategyTester',
    );
    if (!opened) {
      throw new Error('Could not open TradingView Strategy Tester');
    }
  }

  async waitForMetricsAfterChange(
    strategyId: string,
    before: TradingViewReportSnapshot | null,
    signal?: AbortSignal,
    timeoutMs = 30_000,
  ): Promise<TradingViewMetrics> {
    const startedAt = Date.now();
    const beforeToken = before?.token ?? null;
    let lastToken: string | null = null;
    let stableReads = 0;
    let sawReportChange = beforeToken === null;
    let lastMetrics: TradingViewMetrics | null = null;

    // Allow TradingView to invalidate the previous report first.
    await sleep(500, signal);

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      const snapshot = await this.readReportSnapshot(strategyId);

      if (snapshot.error) {
        throw new Error(
          'TradingView strategy runtime error: ' + snapshot.error,
        );
      }

      if (!snapshot.metrics || !snapshot.token) {
        sawReportChange = true;
        stableReads = 0;
        lastToken = null;
        await sleep(250, signal);
        continue;
      }

      lastMetrics = snapshot.metrics;

      if (snapshot.token !== beforeToken) {
        sawReportChange = true;
      }

      if (snapshot.token === lastToken) {
        stableReads += 1;
      } else {
        lastToken = snapshot.token;
        stableReads = 1;
      }

      const elapsed = Date.now() - startedAt;

      // Primary path: TradingView produced a new report revision and it has
      // remained stable across several reads.
      if (
        sawReportChange &&
        stableReads >= 3 &&
        elapsed >= 1_000
      ) {
        return snapshot.metrics;
      }

      // A parameter change may legitimately produce a byte-identical report.
      // After a conservative grace period, accept a stable report rather than
      // incorrectly failing an otherwise valid trial.
      if (
        !sawReportChange &&
        stableReads >= 6 &&
        elapsed >= 5_000
      ) {
        return snapshot.metrics;
      }

      await sleep(300, signal);
    }

    if (lastMetrics) {
      throw new Error(
        'TradingView report remained ambiguous after ' +
          Math.round(timeoutMs / 1000) +
          ' seconds',
      );
    }

    throw new Error(
      'Timed out waiting for TradingView Strategy Tester to recalculate',
    );
  }

  getChartContext(): Promise<{ symbol: string; timeframe: string }> {
    return this.bridge.request<{ symbol: string; timeframe: string }>(
      'getChartContext',
    );
  }
}
