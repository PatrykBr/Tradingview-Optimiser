import { OPTIMISATION_METRICS } from '../../lib/optimisation/metrics';
import type { Primitive } from '../../lib/protocol/types';
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

const primitiveOptions = (
  input: StrategyConfigurationModel['inputs'][number],
): Primitive[] => {
  if (input.type === 'boolean') {
    return [false, true];
  }

  return (input.options ?? []).filter(
    (value): value is Primitive =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
  );
};

export default function StrategyConfigurationSection({
  model,
  activeRunId,
  connected,
  busy,
  onStrategyChange,
  onStart,
  onStop,
}: StrategyConfigurationSectionProps) {
  const locked = activeRunId !== null;
  const { form } = model;

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
          <section>
            <div className="rowLabel">
              <strong>Parameters</strong>
              <span className="muted">
                {model.selectedInputCount}/
                {model.optimisableInputs.length}{' '}
                selected
              </span>
            </div>

            <div className="parameterList">
              {model.optimisableInputs.map(
                (input) => {
                  const config =
                    model.parameterConfigs[
                      input.id
                    ];
                  if (!config) return null;

                  const enabled =
                    config.enabled;
                  const numeric =
                    input.type === 'integer' ||
                    input.type === 'float';
                  const categorical =
                    input.type === 'boolean' ||
                    input.type ===
                      'categorical';

                  const conditionCandidates =
                    model.conditionCandidates(
                      input.id,
                    );
                  const parent =
                    conditionCandidates.find(
                      (candidate) =>
                        candidate.id ===
                        config.conditionParameter,
                    );
                  const parentChoices = parent
                    ? model.parameterConfigs[
                        parent.id
                      ]?.choices ?? []
                    : [];

                  return (
                    <div
                      className={
                        'parameterCard' +
                        (enabled
                          ? ' parameterCardEnabled'
                          : '')
                      }
                      key={input.id}
                    >
                      <label className="parameterHeading">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={enabled}
                          onChange={(event) =>
                            model.setParameterEnabled(
                              input.id,
                              event.target
                                .checked,
                            )
                          }
                        />
                        <span className="parameterName">
                          <strong>
                            {input.label}
                          </strong>
                          <small>
                            {input.type} ·
                            current{' '}
                            {String(
                              input.currentValue,
                            )}
                          </small>
                        </span>
                      </label>

                      {enabled && numeric && (
                        <>
                          <div className="rangeGrid">
                            <label>
                              <span>Min</span>
                              <input
                                type="number"
                                value={config.low}
                                disabled={locked}
                                onChange={(
                                  event,
                                ) =>
                                  model.setParameterField(
                                    input.id,
                                    'low',
                                    event.target
                                      .value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Max</span>
                              <input
                                type="number"
                                value={config.high}
                                disabled={locked}
                                onChange={(
                                  event,
                                ) =>
                                  model.setParameterField(
                                    input.id,
                                    'high',
                                    event.target
                                      .value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Step</span>
                              <input
                                type="number"
                                value={config.step}
                                disabled={
                                  locked ||
                                  config.log
                                }
                                placeholder={
                                  input.type ===
                                  'integer'
                                    ? '1'
                                    : 'auto'
                                }
                                onChange={(
                                  event,
                                ) =>
                                  model.setParameterField(
                                    input.id,
                                    'step',
                                    event.target
                                      .value,
                                  )
                                }
                              />
                            </label>
                          </div>

                          <label className="advancedToggle">
                            <input
                              type="checkbox"
                              checked={config.log}
                              disabled={locked}
                              onChange={(
                                event,
                              ) =>
                                model.setParameterLog(
                                  input.id,
                                  event.target
                                    .checked,
                                )
                              }
                            />
                            Logarithmic search
                          </label>
                        </>
                      )}

                      {enabled &&
                        categorical && (
                          <div className="choiceList">
                            {primitiveOptions(
                              input,
                            ).map((choice) => (
                              <label
                                className="choiceChip"
                                key={String(
                                  choice,
                                )}
                              >
                                <input
                                  type="checkbox"
                                  disabled={
                                    locked
                                  }
                                  checked={config.choices.some(
                                    (value) =>
                                      value ===
                                      choice,
                                  )}
                                  onChange={() =>
                                    model.toggleChoice(
                                      input.id,
                                      choice,
                                    )
                                  }
                                />
                                {String(choice)}
                              </label>
                            ))}
                          </div>
                        )}

                      {enabled &&
                        conditionCandidates.length >
                          0 && (
                          <div className="conditionBlock">
                            <label>
                              <span>
                                Only optimise
                                when
                              </span>
                              <select
                                value={
                                  config.conditionParameter
                                }
                                disabled={
                                  locked
                                }
                                onChange={(
                                  event,
                                ) =>
                                  model.setConditionParameter(
                                    input.id,
                                    event.target
                                      .value,
                                  )
                                }
                              >
                                <option value="">
                                  Always
                                </option>
                                {conditionCandidates.map(
                                  (
                                    candidate,
                                  ) => (
                                    <option
                                      key={
                                        candidate.id
                                      }
                                      value={
                                        candidate.id
                                      }
                                    >
                                      {
                                        candidate.label
                                      }
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>

                            {config.conditionParameter &&
                              parentChoices.length >
                                0 && (
                                <div className="choiceList compactChoices">
                                  {parentChoices.map(
                                    (choice) => (
                                      <label
                                        className="choiceChip"
                                        key={String(
                                          choice,
                                        )}
                                      >
                                        <input
                                          type="checkbox"
                                          disabled={
                                            locked
                                          }
                                          checked={config.conditionValues.some(
                                            (
                                              value,
                                            ) =>
                                              value ===
                                              choice,
                                          )}
                                          onChange={() =>
                                            model.toggleConditionValue(
                                              input.id,
                                              choice,
                                            )
                                          }
                                        />
                                        {String(
                                          choice,
                                        )}
                                      </label>
                                    ),
                                  )}
                                </div>
                              )}
                          </div>
                        )}
                    </div>
                  );
                },
              )}
            </div>
          </section>

          <section>
            <div className="rowLabel">
              <strong>
                Saved configurations
              </strong>
              <span className="muted">
                {model.savedPresets.length}{' '}
                saved
              </span>
            </div>

            <p className="helpText">
              Saved locally for this exact Pine
              strategy version.
            </p>

            <div className="presetSaveRow">
              <input
                type="text"
                value={model.presetName}
                disabled={locked}
                placeholder="Configuration name"
                onChange={(event) =>
                  model.setPresetName(
                    event.target.value,
                  )
                }
              />
              <button
                className="secondary compactButton"
                disabled={
                  busy ||
                  locked ||
                  !model.presetName.trim()
                }
                onClick={() =>
                  void model.saveCurrentPreset()
                }
              >
                Save
              </button>
            </div>

            <div className="presetLoadRow">
              <select
                value={model.selectedPresetId}
                disabled={
                  locked ||
                  model.savedPresets.length ===
                    0
                }
                onChange={(event) =>
                  model.choosePreset(
                    event.target.value,
                  )
                }
              >
                <option value="">
                  Select saved configuration…
                </option>
                {model.savedPresets.map(
                  (preset) => (
                    <option
                      key={preset.id}
                      value={preset.id}
                    >
                      {preset.name}
                    </option>
                  ),
                )}
              </select>
              <button
                className="secondary"
                disabled={
                  busy ||
                  locked ||
                  !model.selectedPresetId
                }
                onClick={() =>
                  void model.loadSelectedPreset()
                }
              >
                Load
              </button>
              <button
                className="textButton presetDelete"
                disabled={
                  busy ||
                  locked ||
                  !model.selectedPresetId
                }
                onClick={() =>
                  void model.deleteSelectedPreset()
                }
              >
                Delete
              </button>
            </div>
          </section>

          <section>
            <strong>Optimisation</strong>

            <div className="fieldGrid">
              <label>
                <span>Metric</span>
                <select
                  value={form.objectiveMetric}
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      objectiveMetric:
                        event.target.value,
                    })
                  }
                >
                  {OPTIMISATION_METRICS.map(
                    (metric) => (
                      <option
                        key={metric.key}
                        value={metric.key}
                      >
                        {metric.label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                <span>Trials</span>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={form.targetTrials}
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      targetTrials:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="subsection">
              <label className="toggleRow">
                <input
                  type="checkbox"
                  checked={
                    form.dateRangeEnabled
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateForm({
                      dateRangeEnabled:
                        event.target.checked,
                    })
                  }
                />
                <span>
                  Custom Deep Backtesting range
                </span>
              </label>

              {form.dateRangeEnabled && (
                <div className="dateGrid">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={form.startDate}
                      disabled={locked}
                      onChange={(event) =>
                        model.updateForm({
                          startDate:
                            event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={form.endDate}
                      disabled={locked}
                      onChange={(event) =>
                        model.updateForm({
                          endDate:
                            event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="filterList">
              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={
                    form.maxDrawdownFilter
                      .enabled
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateFilter(
                      'maxDrawdownFilter',
                      {
                        enabled:
                          event.target.checked,
                      },
                    )
                  }
                />
                <span>Max drawdown %</span>
                <input
                  type="number"
                  value={
                    form.maxDrawdownFilter.value
                  }
                  disabled={
                    locked ||
                    !form.maxDrawdownFilter
                      .enabled
                  }
                  onChange={(event) =>
                    model.updateFilter(
                      'maxDrawdownFilter',
                      {
                        value:
                          event.target.value,
                      },
                    )
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={
                    form.minProfitFactorFilter
                      .enabled
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateFilter(
                      'minProfitFactorFilter',
                      {
                        enabled:
                          event.target.checked,
                      },
                    )
                  }
                />
                <span>Min profit factor</span>
                <input
                  type="number"
                  step="0.01"
                  value={
                    form.minProfitFactorFilter
                      .value
                  }
                  disabled={
                    locked ||
                    !form.minProfitFactorFilter
                      .enabled
                  }
                  onChange={(event) =>
                    model.updateFilter(
                      'minProfitFactorFilter',
                      {
                        value:
                          event.target.value,
                      },
                    )
                  }
                />
              </label>

              <label className="filterRow">
                <input
                  type="checkbox"
                  checked={
                    form.minTradesFilter.enabled
                  }
                  disabled={locked}
                  onChange={(event) =>
                    model.updateFilter(
                      'minTradesFilter',
                      {
                        enabled:
                          event.target.checked,
                      },
                    )
                  }
                />
                <span>Min trades</span>
                <input
                  type="number"
                  value={
                    form.minTradesFilter.value
                  }
                  disabled={
                    locked ||
                    !form.minTradesFilter.enabled
                  }
                  onChange={(event) =>
                    model.updateFilter(
                      'minTradesFilter',
                      {
                        value:
                          event.target.value,
                      },
                    )
                  }
                />
              </label>
            </div>

            {activeRunId === null ? (
              <button
                className="primary"
                disabled={
                  !connected ||
                  busy ||
                  model.selectedInputCount === 0
                }
                onClick={onStart}
              >
                {busy
                  ? 'Preparing…'
                  : 'Start optimisation'}
              </button>
            ) : (
              <button
                className="danger"
                onClick={onStop}
              >
                Stop optimisation
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}
