import { TradingViewBridge } from './bridge';
import type { DetectedStrategy, StrategyInput, TradingViewMetrics } from './types';

interface ApplyParametersResult {
  confirmed: Record<string, unknown>;
}

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

  async readMetrics(): Promise<TradingViewMetrics> {
    throw new Error('TradingView Strategy Tester metric extraction is the next implementation slice');
  }

  getChartContext(): Promise<{ symbol: string; timeframe: string }> {
    return this.bridge.request<{ symbol: string; timeframe: string }>('getChartContext');
  }
}
