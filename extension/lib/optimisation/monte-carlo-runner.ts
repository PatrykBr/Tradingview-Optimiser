import type {
  BacktestRange,
  CreateRun,
  RunProgress,
} from '../protocol/types';
import type {
  TradingViewAdapter,
} from '../tradingview/adapter';
import {
  runTradeMonteCarlo,
  type MonteCarloResult,
} from './monte-carlo';
import type {
  ResearchEvaluation,
} from './research';

export interface MonteCarloExecutionRequest {
  adapter: TradingViewAdapter;
  strategyId: string;
  config: CreateRun;
  progress: RunProgress;
  existingResearch:
    ResearchEvaluation;
  originalParameters:
    Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}

const deepRange = (
  startDate: string,
  endDate: string,
): BacktestRange => ({
  mode: 'deep',
  start_date: startDate,
  end_date: endDate,
});

const chooseRange = (
  config: CreateRun,
  research: ResearchEvaluation,
): {
  source: 'oos' | 'optimisation';
  range: BacktestRange | null;
} => {
  const windows =
    research.robustness
      ?.validationWindows;

  if (
    windows &&
    windows.length > 0
  ) {
    const first = windows[0];
    const last =
      windows[windows.length - 1];

    if (first && last) {
      return {
        source: 'oos',
        range: deepRange(
          first.startDate,
          last.endDate,
        ),
      };
    }
  }

  return {
    source: 'optimisation',
    range:
      config.backtest_range ?? null,
  };
};

export const runMonteCarloValidation =
  async (
    request: MonteCarloExecutionRequest,
  ): Promise<MonteCarloResult> => {
    const settings =
      request.config.research
        ?.monte_carlo;

    if (!settings?.enabled) {
      throw new Error(
        'Monte Carlo validation is not configured for this run',
      );
    }

    const bestParameters =
      request.existingResearch
        .robustness?.winnerParameters ??
      request.progress.best
        ?.parameters;

    if (!bestParameters) {
      return runTradeMonteCarlo(
        {
          available: false,
          trades: [],
          reason:
            'No feasible parameter set is available for Monte Carlo analysis.',
        },
        settings.simulations,
        settings.confidence,
        {
          source: 'optimisation',
          range:
            request.config
              .backtest_range ?? null,
        },
      );
    }

    const context = chooseRange(
      request.config,
      request.existingResearch,
    );

    let primaryFailure: unknown;

    try {
      request.onPhase?.(
        'Preparing Monte Carlo trade sample',
      );

      await request.adapter.evaluateParameters(
        request.strategyId,
        bestParameters,
        context.range
          ? {
              startDate:
                context.range.start_date,
              endDate:
                context.range.end_date,
            }
          : null,
        request.signal,
      );

      await request.adapter.assertRunContext(
        request.strategyId,
        {
          ...request.config,
          backtest_range:
            context.range,
        },
        request.originalParameters,
      );

      const snapshot =
        await request.adapter.readClosedTrades(
          request.strategyId,
        );

      request.onPhase?.(
        snapshot.available
          ? 'Running Monte Carlo simulations'
          : 'Trade-level data unavailable',
      );

      return runTradeMonteCarlo(
        snapshot,
        settings.simulations,
        settings.confidence,
        context,
      );
    } catch (cause) {
      primaryFailure = cause;
      throw cause;
    } finally {
      try {
        await request.adapter.prepareBacktest(
          request.strategyId,
          request.config.backtest_range
            ? {
                startDate:
                  request.config
                    .backtest_range
                    .start_date,
                endDate:
                  request.config
                    .backtest_range
                    .end_date,
              }
            : null,
        );

        await request.adapter.applyParameters(
          request.strategyId,
          bestParameters,
        );
      } catch (restoreFailure) {
        if (primaryFailure === undefined) {
          throw restoreFailure;
        }
      }
    }
  };
