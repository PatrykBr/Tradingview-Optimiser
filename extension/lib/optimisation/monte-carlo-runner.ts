import { combineFailures } from '../errors';
import type {
  BacktestRange,
  CreateRun,
  RunProgress,
} from '../protocol/types';
import type {
  TradingViewBacktestRange,
} from '../tradingview/adapter';
import type {
  ClosedTradeSnapshot,
} from '../tradingview/trades';
import {
  runTradeMonteCarlo,
  type MonteCarloResult,
} from './monte-carlo';
import type {
  ResearchEvaluation,
} from './research';

export interface MonteCarloBacktestAdapter {
  evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
    signal?: AbortSignal,
  ): Promise<Record<string, number>>;
  assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters:
      Record<string, unknown> | null,
  ): Promise<void>;
  readClosedTrades(
    strategyId: string,
  ): Promise<ClosedTradeSnapshot>;
  prepareBacktest(
    strategyId: string,
    range: TradingViewBacktestRange | null,
  ): Promise<void>;
  applyParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

interface MonteCarloExecutionRequest {
  adapter: MonteCarloBacktestAdapter;
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

  const lastWalkForwardFold =
    research.walkForward?.folds.at(-1);

  if (lastWalkForwardFold) {
    return {
      source: 'oos',
      range:
        lastWalkForwardFold.fold.testRange,
    };
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
      request.existingResearch
        .walkForward?.folds.at(-1)
        ?.bestParameters ??
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
        request.signal,
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
        request.signal,
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

        throw combineFailures(
          primaryFailure,
          restoreFailure,
          'Monte Carlo validation failed and TradingView state could not be restored',
        );
      }
    }
  };
