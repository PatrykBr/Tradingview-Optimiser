import SearchSpaceAdvisor from './SearchSpaceAdvisor';
import {
  isPrimitive,
} from '../../lib/optimisation/parameter-config';
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
    isPrimitive,
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
                    model.editParameterConfig({
                      type: 'enabled',
                      id: input.id,
                      enabled:
                        event.target.checked,
                    })
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
                        placeholder={
                          input.min !== undefined
                            ? String(input.min)
                            : 'Set min'
                        }
                        disabled={locked}
                        onChange={(event) =>
                          model.editParameterConfig({
                            type: 'field',
                            id: input.id,
                            field: 'low',
                            value:
                              event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Max</span>
                      <input
                        type="number"
                        value={config.high}
                        placeholder={
                          input.max !== undefined
                            ? String(input.max)
                            : 'Set max'
                        }
                        disabled={locked}
                        onChange={(event) =>
                          model.editParameterConfig({
                            type: 'field',
                            id: input.id,
                            field: 'high',
                            value:
                              event.target.value,
                          })
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
                          model.editParameterConfig({
                            type: 'field',
                            id: input.id,
                            field: 'step',
                            value:
                              event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>

                  <label
                    className="advancedToggle"
                    title="Sample this positive range by ratio rather than by equal linear distance. Use this when plausible values span a large scale, such as 0.001–1 or 1–1000. Avoid it for narrow ranges, values that can be zero/negative, or parameters such as ordinary lookback periods where equal numeric steps make more sense. Fixed Step is disabled while logarithmic search is on."
                  >
                    <input
                      type="checkbox"
                      checked={config.log}
                      disabled={locked}
                      onChange={(event) =>
                        model.editParameterConfig({
                          type: 'log',
                          id: input.id,
                          log:
                            event.target.checked,
                        })
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
                            model.editParameterConfig({
                              type: 'choice',
                              id: input.id,
                              choice,
                            })
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
                    <label
                      title="Make this parameter conditional on any Pine dropdown or boolean input. If the controller is not already being optimised, selecting it here adds it automatically."
                    >
                      <span>Active when</span>
                      <select
                        value={
                          config.conditionParameter
                        }
                        disabled={locked}
                        onChange={(event) =>
                          model.editParameterConfig({
                            type: 'condition',
                            id: input.id,
                            parameterId:
                              event.target.value,
                          })
                        }
                      >
                        <option value="">
                          Always
                        </option>
                        {conditionCandidates.map(
                          (candidate) => {
                            const controllerEnabled =
                              model.parameterConfigs[
                                candidate.id
                              ]?.enabled ?? false;

                            return (
                              <option
                                key={candidate.id}
                                value={candidate.id}
                              >
                                {candidate.label}
                                {controllerEnabled
                                  ? ''
                                  : ' (add to optimisation)'}
                              </option>
                            );
                          },
                        )}
                      </select>
                    </label>

                    {config.conditionParameter &&
                      parentChoices.length > 0 && (
                        <>
                          <div className="conditionValueLabel">
                            {parent?.label ?? 'Controller'} is:
                          </div>
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
                                      model.editParameterConfig({
                                        type:
                                          'condition-value',
                                        id: input.id,
                                        value:
                                          choice,
                                      })
                                    }
                                  />
                                  {String(choice)}
                                </label>
                              ),
                            )}
                          </div>
                        </>
                      )}
                  </div>
                )}
            </div>
          );
        })}
      </div>

      <SearchSpaceAdvisor model={model} />
    </section>
  );
}
