import type {
  CreateRun,
  NextTrial,
  TrialResult,
} from '../protocol/types';
import type {
  TradingViewBacktestRange,
} from '../tradingview/adapter';

export interface OptimisationTrialAdapter {
  assertRunContext(
    strategyId: string,
    config: CreateRun,
    originalParameters:
      Record<string, unknown> | null,
  ): Promise<void>;
  evaluateParameters(
    strategyId: string,
    parameters: Record<string, unknown>,
    range: TradingViewBacktestRange | null,
    signal?: AbortSignal,
  ): Promise<Record<string, number>>;
}

export type TrialExecutionPhase =
  | 'checking'
  | 'recalculating'
  | 'submitting';

export interface TrialExecutionUpdate {
  number: number;
  parameters: Record<string, unknown>;
  phase: TrialExecutionPhase;
}

export interface EvaluateTrialRequest {
  adapter: OptimisationTrialAdapter;
  strategyId: string;
  config: CreateRun;
  trial: NextTrial;
  originalParameters:
    Record<string, unknown> | null;
  signal?: AbortSignal;
  onPhase?: (
    update: TrialExecutionUpdate,
  ) => void;
}

const rangeFor = (
  config: CreateRun,
): TradingViewBacktestRange | null =>
  config.backtest_range
    ? {
        startDate:
          config.backtest_range
            .start_date,
        endDate:
          config.backtest_range
            .end_date,
      }
    : null;

export const evaluateOptimisationTrial =
  async (
    request: EvaluateTrialRequest,
  ): Promise<TrialResult> => {
    const startedAt = Date.now();

    request.onPhase?.({
      number:
        request.trial.trial_number,
      parameters:
        request.trial.parameters,
      phase: 'checking',
    });

    await request.adapter.assertRunContext(
      request.strategyId,
      request.config,
      request.originalParameters,
    );

    request.onPhase?.({
      number:
        request.trial.trial_number,
      parameters:
        request.trial.parameters,
      phase: 'recalculating',
    });

    const metrics =
      await request.adapter.evaluateParameters(
        request.strategyId,
        request.trial.parameters,
        rangeFor(request.config),
        request.signal,
      );

    await request.adapter.assertRunContext(
      request.strategyId,
      request.config,
      request.originalParameters,
    );

    request.onPhase?.({
      number:
        request.trial.trial_number,
      parameters:
        request.trial.parameters,
      phase: 'submitting',
    });

    return {
      run_id: request.trial.run_id,
      trial_number:
        request.trial.trial_number,
      metrics,
      duration_ms:
        Date.now() - startedAt,
    };
  };
