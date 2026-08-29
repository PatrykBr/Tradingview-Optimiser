import { useMemo, useState } from 'react';

import BackendSection from './optimiser/BackendSection';
import ResearchSection from './optimiser/ResearchSection';
import RunProgressSection from './optimiser/RunProgressSection';
import StrategyConfigurationSection from './optimiser/StrategyConfigurationSection';
import { useOptimisationRun } from './optimiser/useOptimisationRun';
import { useResearchValidation } from './optimiser/useResearchValidation';
import { useStrategyConfiguration } from './optimiser/useStrategyConfiguration';
import { TradingViewAdapter } from '../lib/tradingview/adapter';
import type { TradingViewBridge } from '../lib/tradingview/bridge';

interface AppProps {
  bridge: TradingViewBridge;
}

export default function App({ bridge }: AppProps) {
  const adapter = useMemo(
    () => new TradingViewAdapter(bridge),
    [bridge],
  );
  const [error, setError] = useState<string>();

  const configuration =
    useStrategyConfiguration(adapter, setError);

  const run = useOptimisationRun({
    adapter,
    prepareRun: configuration.prepareRun,
    restorePersistedRun:
      configuration.restorePersistedRun,
    selectedStrategyId:
      configuration.selectedStrategyId,
    setError,
  });

  const research = useResearchValidation({
    adapter,
    run,
    strategyId: configuration.selectedStrategyId,
    setError,
  });

  const busy =
    configuration.busy ||
    run.busy ||
    research.busy;

  const changeStrategy = (strategyId: string) => {
    setError(undefined);
    configuration.selectStrategy(strategyId);
    run.clearDisplayedRun();
  };

  const loadExperiment = async (
    config: Parameters<
      typeof configuration.loadExperimentConfiguration
    >[0],
  ) => {
    setError(undefined);

    try {
      await configuration.loadExperimentConfiguration(
        config,
      );
      run.clearDisplayedRun();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    }
  };

  const rerunExperiment = async (
    config: Parameters<
      typeof configuration.prepareExperimentRerun
    >[0],
  ) => {
    setError(undefined);

    try {
      const prepared =
        await configuration.prepareExperimentRerun(
          config,
        );
      await run.startPreparedOptimisation(
        prepared,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      );
    }
  };

  return (
    <main className="panel">
      <BackendSection
        run={run}
        busy={busy}
      />

      <StrategyConfigurationSection
        model={configuration}
        activeRunId={run.activeRunId}
        connected={run.connected}
        busy={busy}
        onStrategyChange={changeStrategy}
        onStart={() =>
          void run.startOptimisation()
        }
        onStop={() =>
          void run.stopOptimisation()
        }
      />

      <RunProgressSection
        run={run}
        inputLabel={configuration.inputLabel}
        fallbackTargetTrials={
          configuration.form.targetTrials
        }
        busy={busy}
      />

      <ResearchSection
        run={run}
        research={research}
        inputLabel={configuration.inputLabel}
        onLoadExperiment={loadExperiment}
        onRerunExperiment={rerunExperiment}
      />

      {error && (
        <div className="error">{error}</div>
      )}
    </main>
  );
}
