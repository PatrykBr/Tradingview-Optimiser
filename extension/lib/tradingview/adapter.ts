import type { CreateRun } from '../protocol/types';
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

export interface TradingViewBacktestRange {
  startDate: string;
  endDate: string;
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

  getBacktestMode(): Promise<'chart' | 'deep'> {
    return this.bridge.request<'chart' | 'deep'>('getBacktestMode');
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

  async assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters: Record<string, unknown> | null,
  ): Promise<void> {
    const chart = await this.getChartContext();

    if (
      config.chart.symbol !== chart.symbol ||
      config.chart.timeframe !== chart.timeframe
    ) {
      throw new Error(
        'SAFETY: TradingView chart changed. Expected ' +
          config.chart.symbol +
          ' ' +
          config.chart.timeframe +
          ', got ' +
          chart.symbol +
          ' ' +
          chart.timeframe,
      );
    }

    const signature =
      await this.getStrategySignature(strategyId);

    if (originalParameters) {
      const optimisedIds = new Set(
        config.parameters.map(
          (parameter) => parameter.name,
        ),
      );
      const liveInputs =
        await this.readStrategyInputs(strategyId);

      for (const input of liveInputs) {
        if (
          optimisedIds.has(input.id) ||
          !(input.id in originalParameters)
        ) {
          continue;
        }

        if (
          JSON.stringify(input.currentValue) !==
          JSON.stringify(
            originalParameters[input.id],
          )
        ) {
          throw new Error(
            'SAFETY: Fixed strategy input "' +
              input.label +
              '" changed during the optimisation.',
          );
        }
      }
    }

    const backtestMode =
      await this.getBacktestMode();
    const expectedMode = config.backtest_range
      ? 'deep'
      : 'chart';

    if (backtestMode !== expectedMode) {
      throw new Error(
        'SAFETY: TradingView backtest mode changed during the optimisation.',
      );
    }

    if (
      signature !==
      config.chart.strategy_signature
    ) {
      throw new Error(
        'SAFETY: The TradingView strategy or its input structure changed during the optimisation.',
      );
    }

    const expectedSettingsSignature =
      config.chart.strategy_settings_signature;
    if (expectedSettingsSignature) {
      const liveSettingsSignature =
        await this.getStrategySettingsSignature(
          strategyId,
        );

      if (
        liveSettingsSignature !==
        expectedSettingsSignature
      ) {
        throw new Error(
          'SAFETY: TradingView strategy properties changed during the optimisation.',
        );
      }
    }

    if (config.backtest_range) {
      await this.assertDeepBacktestRange(
        strategyId,
        config.backtest_range.start_date,
        config.backtest_range.end_date,
      );
    }
  }

  async prepareBacktest(
    strategyId: string,
    range: TradingViewBacktestRange | null,
  ): Promise<void> {
    await this.ensureStrategyTester();

    if (!range) {
      await this.resetToChartSession();
      return;
    }

    const before = await this.readReportSnapshot(strategyId);
    await this.#applyDeepBacktestRange(range);

    await this.waitForMetricsAfterChange(
      strategyId,
      before,
      undefined,
      30_000,
    );

    await this.assertDeepBacktestRange(
      strategyId,
      range.startDate,
      range.endDate,
    );
  }

  async evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
    signal?: AbortSignal,
  ): Promise<TradingViewMetrics> {
    const before = await this.readReportSnapshot(strategyId);
    await this.applyParameters(strategyId, parameters);

    if (range) {
      await this.#applyDeepBacktestRange(range);
    }

    try {
      return await this.waitForMetricsAfterChange(
        strategyId,
        before,
        signal,
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : String(cause);

      if (!/timed out|remained ambiguous/i.test(message)) {
        throw cause;
      }

      await this.ensureStrategyTester();
      const retryBefore = await this.readReportSnapshot(strategyId);
      await this.applyParameters(strategyId, parameters);

      if (range) {
        await this.#applyDeepBacktestRange(range);
      }

      return this.waitForMetricsAfterChange(
        strategyId,
        retryBefore,
        signal,
        35_000,
      );
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
    const beforeObjectId = before?.objectId ?? null;
    let lastRevision: string | null = null;
    let stableReads = 0;
    let sawReportChange = beforeToken === null && beforeObjectId === null;
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
        lastRevision = null;
        await sleep(250, signal);
        continue;
      }

      lastMetrics = snapshot.metrics;

      if (
        snapshot.token !== beforeToken ||
        (snapshot.objectId !== null &&
          snapshot.objectId !== beforeObjectId)
      ) {
        sawReportChange = true;
      }

      const revision =
        String(snapshot.objectId ?? 'no-object') +
        ':' +
        snapshot.token;

      if (revision === lastRevision) {
        stableReads += 1;
      } else {
        lastRevision = revision;
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

  async assertDeepBacktestRange(
    strategyId: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    const snapshot = await this.readReportSnapshot(strategyId);
    const range = snapshot.backtestRange;

    // TradingView does not expose settings.dateRange on every account/build.
    // When it does, validate it so a stale or wrong Deep report cannot be
    // accepted as the current trial.
    if (!range) return;

    const expectedFrom = Date.parse(startDate + 'T00:00:00Z');
    const expectedTo = Date.parse(endDate + 'T00:00:00Z');
    const toleranceMs = 36 * 60 * 60 * 1000;

    if (
      Math.abs(range.from - expectedFrom) > toleranceMs ||
      Math.abs(range.to - expectedTo) > toleranceMs
    ) {
      throw new Error(
        'SAFETY: TradingView Deep Backtesting report date range does not match the optimisation configuration.',
      );
    }
  }

  async getStrategySettingsSignature(
    strategyId: string,
  ): Promise<string | null> {
    return (await this.readReportSnapshot(strategyId)).settingsSignature;
  }

  async #applyDeepBacktestRange(
    range: TradingViewBacktestRange,
  ): Promise<void> {
    const result = await this.configureDeepBacktestRange(
      range.startDate,
      range.endDate,
    );

    if (!result.supported || !result.applied) {
      throw new Error(
        result.reason ??
          'TradingView Deep Backtesting could not be updated',
      );
    }
  }

  getChartContext(): Promise<{ symbol: string; timeframe: string }> {
    return this.bridge.request<{ symbol: string; timeframe: string }>(
      'getChartContext',
    );
  }
}
