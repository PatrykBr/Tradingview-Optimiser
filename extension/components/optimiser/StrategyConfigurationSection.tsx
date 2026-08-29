import OptimisationSettingsSection from './OptimisationSettingsSection';
import ParameterSearchSpaceSection from './ParameterSearchSpaceSection';
import SavedConfigurationsSection from './SavedConfigurationsSection';
import type { StrategyConfigurationModel } from './useStrategyConfiguration';

interface StrategyConfigurationSectionProps {
  model: StrategyConfigurationModel;
  activeRunId: string | null;
  connected: boolean;
  busy: boolean;
  onStrategyChange: (strategyId: string) => void;
  onStart: () => void;
  onStop: () => void;
}

export default function StrategyConfigurationSection({
  model,
  activeRunId,
  connected,
  busy,
  onStrategyChange,
  onStart,
  onStop,
}: StrategyConfigurationSectionProps) {
  const locked =
    activeRunId !== null || busy;

  return (
    <>
      <section>
        <div className="rowLabel">
          <label htmlFor="strategy">Strategy</label>
          <button
            className="textButton"
            disabled={locked}
            onClick={() => void model.probe()}
          >
            Refresh
          </button>
        </div>

        <select
          id="strategy"
          value={model.selectedStrategyId}
          disabled={locked}
          onChange={(event) =>
            onStrategyChange(event.target.value)
          }
        >
          <option value="">Select strategy…</option>
          {model.strategies.map((strategy) => (
            <option
              key={strategy.id}
              value={strategy.id}
            >
              {strategy.name}
            </option>
          ))}
        </select>

        <div className="buttonRow twoButtons">
          <button
            className="secondary"
            disabled={
              !model.selectedStrategyId ||
              busy ||
              locked
            }
            onClick={() => void model.readInputs()}
          >
            {model.inputs.length > 0
              ? 'Reload inputs'
              : 'Read inputs'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void model.runDiagnostics()
            }
          >
            Diagnostics
          </button>
        </div>
      </section>

      {model.diagnosticsOpen &&
        model.diagnostics && (
          <section>
            <div className="rowLabel">
              <strong>Compatibility</strong>
              <button
                className="textButton"
                onClick={model.hideDiagnostics}
              >
                Hide
              </button>
            </div>

            <div className="diagnosticList">
              {model.diagnostics.checks.map(
                (check) => (
                  <div
                    className="diagnosticRow"
                    key={check.id}
                  >
                    <span
                      className={
                        check.ok
                          ? 'diagnosticDot ok'
                          : 'diagnosticDot bad'
                      }
                    />
                    <div>
                      <strong>
                        {check.label}
                      </strong>
                      {check.detail && (
                        <small>
                          {check.detail}
                        </small>
                      )}
                    </div>
                  </div>
                ),
              )}

              <div className="diagnosticRow">
                <span
                  className={
                    model.diagnostics
                      .deepBacktesting.available
                      ? 'diagnosticDot ok'
                      : 'diagnosticDot neutral'
                  }
                />
                <div>
                  <strong>
                    Deep Backtesting
                  </strong>
                  <small>
                    {model.diagnostics
                      .deepBacktesting.available
                      ? 'Available'
                      : model.diagnostics
                          .deepBacktesting.reason}
                  </small>
                </div>
              </div>
            </div>
          </section>
        )}

      {model.inputs.length > 0 && (
        <>
          <ParameterSearchSpaceSection
            model={model}
            locked={locked}
          />
          <SavedConfigurationsSection
            model={model}
            locked={locked}
            busy={busy}
          />
          <OptimisationSettingsSection
            model={model}
            activeRunId={activeRunId}
            connected={connected}
            busy={busy}
            onStart={onStart}
            onStop={onStop}
          />
        </>
      )}
    </>
  );
}
