import type {
  CreateRun,
} from '../protocol/types';
import type {
  DiagnosticCheck,
  TradingViewDiagnostics,
} from '../tradingview/types';

export interface CompatibilityAdapter {
  diagnostics(
    strategyId: string,
  ): Promise<TradingViewDiagnostics>;
}

const CRITICAL_CHECKS = new Set([
  'chart-api',
  'strategy-detection',
  'inputs-readable',
  'inputs-writable',
  'report-source',
  'metrics-readable',
  'strategy-signature',
]);

export const compatibilityFailureReason =
  async (
    adapter: CompatibilityAdapter,
    strategyId: string,
    config: CreateRun,
  ): Promise<string | null> => {
    const diagnostics =
      await adapter.diagnostics(
        strategyId,
      );
    const failed: DiagnosticCheck[] =
      diagnostics.checks.filter(
        (check) =>
          CRITICAL_CHECKS.has(
            check.id,
          ) &&
          !check.ok,
      );

    if (
      config.backtest_range &&
      !diagnostics.deepBacktesting
        .available
    ) {
      failed.push({
        id: 'deep-backtesting',
        label: 'Deep Backtesting',
        ok: false,
        detail:
          diagnostics.deepBacktesting
            .reason ??
          'Unavailable',
      });
    }

    if (failed.length === 0) {
      return null;
    }

    return failed
      .map(
        (check) =>
          check.label +
          (check.detail
            ? ': ' + check.detail
            : ''),
      )
      .join('; ');
  };
