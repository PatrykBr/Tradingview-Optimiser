import {
  OptimiserError,
  isOptimiserErrorCode,
} from '../errors';
import type { CreateRun } from '../protocol/types';
import type { TradingViewBridge } from './bridge';
import type { ClosedTradeSnapshot } from './trades';
import type {
  DeepBacktestResult,
  DetectedStrategy,
  StrategyInput,
  TradingViewDiagnostics,
  TradingViewMetricSource,
  TradingViewMetrics,
  TradingViewReportPollSnapshot,
  TradingViewReportSnapshot,
  TradingViewRunContextSnapshot,
} from './types';

interface ApplyParametersResult {
  confirmed: Record<string, unknown>;
}

export interface TradingViewBacktestRange {
  startDate: string;
  endDate: string;
}

const expectedMetricSource = (
  deepBacktesting: boolean,
): TradingViewMetricSource =>
  deepBacktesting
    ? 'deep-visible'
    : 'internal';

const safetyError = (
  message: string,
): OptimiserError =>
  new OptimiserError(
    'TV_CONTEXT_CHANGED',
    message,
  );

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
  #verifiedDeepRangeKey: string | null = null;

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

  readMetrics(
    strategyId: string,
    expectedDeepBacktesting?: boolean,
  ): Promise<TradingViewMetrics | null> {
    return this.bridge.request<TradingViewMetrics | null>(
      'readMetrics',
      {
        strategyId,
        ...(expectedDeepBacktesting === undefined
          ? {}
          : { expectedDeepBacktesting }),
      },
    );
  }

  readReportPollSnapshot(
    strategyId: string,
    expectedDeepBacktesting = false,
  ): Promise<TradingViewReportPollSnapshot> {
    return this.bridge.request<TradingViewReportPollSnapshot>(
      'readReportPollSnapshot',
      {
        strategyId,
        expectedDeepBacktesting,
      },
    );
  }

  readReportSnapshot(
    strategyId: string,
  ): Promise<TradingViewReportSnapshot> {
    return this.bridge.request<TradingViewReportSnapshot>(
      'readReportSnapshot',
      { strategyId },
    );
  }

  readClosedTrades(
    strategyId: string,
  ): Promise<ClosedTradeSnapshot> {
    return this.bridge.request<ClosedTradeSnapshot>(
      'readClosedTrades',
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
    const payload =
      strategyId === undefined
        ? undefined
        : { strategyId };

    return this.bridge.request<TradingViewDiagnostics>(
      'diagnostics',
      payload,
    );
  }

  getRunContextSnapshot(
    strategyId: string,
  ): Promise<TradingViewRunContextSnapshot> {
    return this.bridge.request<TradingViewRunContextSnapshot>(
      'getRunContextSnapshot',
      { strategyId },
    );
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
      throw new OptimiserError(
        'TV_STRATEGY_TESTER_UNAVAILABLE',
        'Could not open TradingView Strategy Tester',
      );
    }
  }

  async assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters: Record<string, unknown> | null,
  ): Promise<void> {
    const snapshot =
      await this.getRunContextSnapshot(
        strategyId,
      );

    if (
      config.chart.symbol !==
        snapshot.symbol ||
      config.chart.timeframe !==
        snapshot.timeframe
    ) {
      throw safetyError(
        'SAFETY: TradingView chart changed. Expected ' +
          config.chart.symbol +
          ' ' +
          config.chart.timeframe +
          ', got ' +
          snapshot.symbol +
          ' ' +
          snapshot.timeframe,
      );
    }

    if (originalParameters) {
      const optimisedIds = new Set(
        config.parameters.map(
          (parameter) => parameter.name,
        ),
      );

      for (const input of snapshot.inputs) {
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
          throw safetyError(
            'SAFETY: Fixed strategy input "' +
              input.label +
              '" changed during the optimisation.',
          );
        }
      }
    }

    const expectedMode = config.backtest_range
      ? 'deep'
      : 'chart';

    if (
      snapshot.backtestMode !==
      expectedMode
    ) {
      this.#verifiedDeepRangeKey = null;
      throw safetyError(
        'SAFETY: TradingView backtest mode changed during the optimisation.',
      );
    }

    if (
      snapshot.strategySignature !==
      config.chart.strategy_signature
    ) {
      throw safetyError(
        'SAFETY: The TradingView strategy or its input structure changed during the optimisation.',
      );
    }

    const expectedSettingsSignature =
      config.chart.strategy_settings_signature;

    if (
      expectedSettingsSignature &&
      snapshot.settingsSignature !==
        expectedSettingsSignature
    ) {
      throw safetyError(
        'SAFETY: TradingView strategy properties changed during the optimisation.',
      );
    }

    if (config.backtest_range) {
      const verified =
        this.#assertSnapshotDeepRange(
          snapshot.backtestRange,
          config.backtest_range.start_date,
          config.backtest_range.end_date,
        );

      this.#verifiedDeepRangeKey =
        verified
          ? this.#rangeKey({
              startDate:
                config.backtest_range
                  .start_date,
              endDate:
                config.backtest_range
                  .end_date,
            })
          : null;
    } else {
      this.#verifiedDeepRangeKey = null;
    }
  }

  async prepareBacktest(
    strategyId: string,
    range: TradingViewBacktestRange | null,
  ): Promise<void> {
    await this.ensureStrategyTester();

    if (!range) {
      this.#verifiedDeepRangeKey = null;
      await this.resetToChartSession();
      return;
    }

    const before =
      await this.readReportPollSnapshot(
        strategyId,
        true,
      );
    await this.#applyDeepBacktestRange(
      range,
    );

    await this.waitForMetricsAfterChange(
      strategyId,
      before,
      undefined,
      30_000,
      true,
    );

    const verified =
      await this.#verifyDeepBacktestRange(
        strategyId,
        range.startDate,
        range.endDate,
      );

    this.#verifiedDeepRangeKey =
      verified
        ? this.#rangeKey(range)
        : null;
  }

  async evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
    signal?: AbortSignal,
  ): Promise<TradingViewMetrics> {
    const expectedDeepBacktesting =
      range !== null;
    const before =
      await this.readReportPollSnapshot(
        strategyId,
        expectedDeepBacktesting,
      );
    await this.applyParameters(
      strategyId,
      parameters,
    );

    if (range) {
      const rangeKey =
        this.#rangeKey(range);

      if (
        this.#verifiedDeepRangeKey ===
        rangeKey
      ) {
        try {
          await this.#refreshDeepBacktest();
        } catch (cause) {
          if (
            !isOptimiserErrorCode(
              cause,
              'TV_DEEP_BACKTEST_UNAVAILABLE',
            )
          ) {
            throw cause;
          }

          this.#verifiedDeepRangeKey = null;
          await this.#applyDeepBacktestRange(
            range,
          );
        }
      } else {
        await this.#applyDeepBacktestRange(
          range,
        );
      }
    }

    try {
      return await this.waitForMetricsAfterChange(
        strategyId,
        before,
        signal,
        30_000,
        expectedDeepBacktesting,
      );
    } catch (cause) {
      if (
        !isOptimiserErrorCode(
          cause,
          'TV_REPORT_TIMEOUT',
          'TV_REPORT_AMBIGUOUS',
        )
      ) {
        throw cause;
      }

      await this.ensureStrategyTester();
      const retryBefore =
        await this.readReportPollSnapshot(
          strategyId,
          expectedDeepBacktesting,
        );
      await this.applyParameters(
        strategyId,
        parameters,
      );

      if (range) {
        this.#verifiedDeepRangeKey = null;
        await this.#applyDeepBacktestRange(
          range,
        );
      }

      return this.waitForMetricsAfterChange(
        strategyId,
        retryBefore,
        signal,
        35_000,
        expectedDeepBacktesting,
      );
    }
  }

  async waitForMetricsAfterChange(
    strategyId: string,
    before: TradingViewReportPollSnapshot | null,
    signal?: AbortSignal,
    timeoutMs = 30_000,
    expectedDeepBacktesting = false,
  ): Promise<TradingViewMetrics> {
    const startedAt = Date.now();
    const beforeToken = before?.token ?? null;
    const beforeObjectId = before?.objectId ?? null;
    let lastRevision: string | null = null;
    let stableReads = 0;
    let sawReportChange = beforeToken === null && beforeObjectId === null;
    let lastMetrics: TradingViewMetrics | null = null;

    // Poll soon after the parameter write while still requiring several
    // stable reads before accepting a new report revision.
    await sleep(125, signal);

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      const snapshot =
        await this.readReportPollSnapshot(
          strategyId,
          expectedDeepBacktesting,
        );

      if (snapshot.error) {
        throw new OptimiserError(
          'TV_STRATEGY_RUNTIME',
          'TradingView strategy runtime error: ' +
            snapshot.error,
        );
      }

      if (!snapshot.metrics || !snapshot.token) {
        sawReportChange = true;
        stableReads = 0;
        lastRevision = null;
        await sleep(150, signal);
        continue;
      }

      const expectedSource =
        expectedMetricSource(
          expectedDeepBacktesting,
        );
      if (
        snapshot.metricSource !==
        expectedSource
      ) {
        throw new OptimiserError(
          'TV_METRIC_SOURCE_CHANGED',
          'TradingView metric source changed or became ambiguous. Expected ' +
            expectedSource +
            ', got ' +
            String(
              snapshot.metricSource,
            ),
        );
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

      // Accept a new report revision after several reads confirm it is stable.
      if (
        sawReportChange &&
        stableReads >= 3 &&
        elapsed >= 500
      ) {
        const metrics =
          await this.readMetrics(
            strategyId,
            expectedDeepBacktesting,
          );

        if (!metrics) {
          throw new OptimiserError(
            'TV_REPORT_PARSE_FAILED',
            'TradingView report became unavailable after it appeared stable',
          );
        }

        return metrics;
      }

      await sleep(
        elapsed < 1_500 ? 125 : 250,
        signal,
      );
    }

    if (lastMetrics) {
      throw new OptimiserError(
        'TV_REPORT_AMBIGUOUS',
        'TradingView report remained ambiguous after ' +
          Math.round(timeoutMs / 1000) +
          ' seconds',
        true,
      );
    }

    throw new OptimiserError(
      'TV_REPORT_TIMEOUT',
      'Timed out waiting for TradingView Strategy Tester to recalculate',
      true,
    );
  }

  async #verifyDeepBacktestRange(
    strategyId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    const snapshot =
      await this.readReportSnapshot(
        strategyId,
      );

    return this.#assertSnapshotDeepRange(
      snapshot.backtestRange,
      startDate,
      endDate,
    );
  }

  #assertSnapshotDeepRange(
    range:
      | {
          from: number;
          to: number;
        }
      | null,
    startDate: string,
    endDate: string,
  ): boolean {
    // Some TradingView accounts or builds omit settings.dateRange. If it is
    // missing, rewrite the date range on each trial because we cannot verify it.
    if (!range) return false;

    const expectedFrom = Date.parse(
      startDate + 'T00:00:00Z',
    );
    const expectedTo = Date.parse(
      endDate + 'T00:00:00Z',
    );
    const toleranceMs =
      36 * 60 * 60 * 1000;

    if (
      Math.abs(
        range.from - expectedFrom,
      ) > toleranceMs ||
      Math.abs(
        range.to - expectedTo,
      ) > toleranceMs
    ) {
      throw safetyError(
        'SAFETY: TradingView Deep Backtesting report date range does not match the optimisation configuration.',
      );
    }

    return true;
  }

  #rangeKey(
    range: TradingViewBacktestRange,
  ): string {
    return (
      range.startDate +
      '|' +
      range.endDate
    );
  }

  async #refreshDeepBacktest(): Promise<void> {
    const result =
      await this.bridge.request<DeepBacktestResult>(
        'refreshDeepBacktestReport',
        undefined,
        5_000,
      );

    if (
      !result.supported ||
      !result.applied
    ) {
      throw new OptimiserError(
        'TV_DEEP_BACKTEST_UNAVAILABLE',
        result.reason ??
          'TradingView Deep Backtesting report could not be refreshed',
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
      throw new OptimiserError(
        'TV_DEEP_BACKTEST_UNAVAILABLE',
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
