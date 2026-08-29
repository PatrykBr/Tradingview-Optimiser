import type { Primitive } from '../../lib/protocol/types';
import type { StrategyConfigurationModel } from './useStrategyConfiguration';

interface ParameterSearchSpaceSectionProps {
  model: StrategyConfigurationModel;
  locked: boolean;
}

const primitiveOptions = (
  input: StrategyConfigurationModel['inputs'][number],
): Primitive[] => {
  if (input.type === 'boolean') return [false, true];

  return (input.options ?? []).filter(
    (value): value is Primitive =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
  );
};

export default function ParameterSearchSpaceSection({
  model,
  locked,
}: ParameterSearchSpaceSectionProps) {
  return (
    <section>
      <div className="rowLabel">
        <strong>Parameters</strong>
        <span className="muted">
          {model.selectedInputCount}/
          {model.optimisableInputs.length} selected
        </span>
      </div>

      <div className="parameterList">
        {model.optimisableInputs.map((input) => {
          const config =
            model.parameterConfigs[input.id];
          if (!config) return null;

          const enabled = config.enabled;
          const numeric =
            input.type === 'integer' ||
            input.type === 'float';
          const categorical =
            input.type === 'boolean' ||
            input.type === 'categorical';

          const conditionCandidates =
            model.conditionCandidates(input.id);
          const parent = conditionCandidates.find(
            (candidate) =>
              candidate.id ===
              config.conditionParameter,
          );
          const parentChoices = parent
            ? model.parameterConfigs[parent.id]
                ?.choices ?? []
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
                      event.target.checked,
                    )
                  }
                />
                <span className="parameterName">
                  <strong>{input.label}</strong>
                  <small>
                    {input.type} · current{' '}
                    {String(input.currentValue)}
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
                        onChange={(event) =>
                          model.setParameterField(
                            input.id,
                            'low',
                            event.target.value,
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
                        onChange={(event) =>
                          model.setParameterField(
                            input.id,
                            'high',
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label
                      title={
                        input.type === 'integer'
                          ? input.step !== undefined
                            ? 'Optional. Leave blank for Auto, which uses Pine\'s declared step of ' +
                              input.step +
                              '. Enter a value only to override that granularity.'
                            : 'Optional. Leave blank for Auto, which uses step 1 for integer parameters. Enter a value only to override it.'
                          : input.step !== undefined
                            ? 'Optional. Leave blank for Auto, which uses Pine\'s declared step of ' +
                              input.step +
                              '. If Pine declares no step, Auto lets Optuna search continuously.'
                            : 'Optional. Leave blank for Auto, which lets Optuna search this float continuously. Enter a value only when you deliberately want a fixed grid.'
                      }
                    >
                      <span>Step (optional)</span>
                      <input
                        type="number"
                        value={config.step}
                        disabled={
                          locked || config.log
                        }
                        placeholder={
                          input.type === 'integer'
                            ? input.step !== undefined
                              ? 'Auto (' +
                                input.step +
                                ')'
                              : 'Auto (1)'
                            : input.step !== undefined
                              ? 'Auto (' +
                                input.step +
                                ')'
                              : 'Auto (continuous)'
                        }
                        onChange={(event) =>
                          model.setParameterField(
                            input.id,
                            'step',
                            event.target.value,
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
                      onChange={(event) =>
                        model.setParameterLog(
                          input.id,
                          event.target.checked,
                        )
                      }
                    />
                    Logarithmic search
                  </label>
                </>
              )}

              {enabled && categorical && (
                <div className="choiceList">
                  {primitiveOptions(input).map(
                    (choice) => (
                      <label
                        className="choiceChip"
                        key={String(choice)}
                      >
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={config.choices.some(
                            (value) =>
                              value === choice,
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
                    ),
                  )}
                </div>
              )}

              {enabled &&
                conditionCandidates.length > 0 && (
                  <div className="conditionBlock">
                    <label>
                      <span>Only optimise when</span>
                      <select
                        value={
                          config.conditionParameter
                        }
                        disabled={locked}
                        onChange={(event) =>
                          model.setConditionParameter(
                            input.id,
                            event.target.value,
                          )
                        }
                      >
                        <option value="">
                          Always
                        </option>
                        {conditionCandidates.map(
                          (candidate) => (
                            <option
                              key={candidate.id}
                              value={candidate.id}
                            >
                              {candidate.label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    {config.conditionParameter &&
                      parentChoices.length > 0 && (
                        <div className="choiceList compactChoices">
                          {parentChoices.map(
                            (choice) => (
                              <label
                                className="choiceChip"
                                key={String(choice)}
                              >
                                <input
                                  type="checkbox"
                                  disabled={locked}
                                  checked={config.conditionValues.some(
                                    (value) =>
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
                                {String(choice)}
                              </label>
                            ),
                          )}
                        </div>
                      )}
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
