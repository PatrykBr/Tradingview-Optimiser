import type { StrategyConfigurationModel } from './useStrategyConfiguration';

interface SavedConfigurationsSectionProps {
  model: StrategyConfigurationModel;
  locked: boolean;
  busy: boolean;
}

export default function SavedConfigurationsSection({
  model,
  locked,
  busy,
}: SavedConfigurationsSectionProps) {
  return (
    <section>
      <div className="rowLabel">
        <strong>Saved configurations</strong>
        <span className="muted">
          {model.savedPresets.length} saved
        </span>
      </div>

      <p className="helpText">
        Saved locally for this exact Pine strategy
        version.
      </p>

      <div className="presetSaveRow">
        <input
          type="text"
          value={model.presetName}
          disabled={locked}
          placeholder="Configuration name"
          onChange={(event) =>
            model.setPresetName(event.target.value)
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
            model.savedPresets.length === 0
          }
          onChange={(event) =>
            model.choosePreset(event.target.value)
          }
        >
          <option value="">
            Select saved configuration…
          </option>
          {model.savedPresets.map((preset) => (
            <option
              key={preset.id}
              value={preset.id}
            >
              {preset.name}
            </option>
          ))}
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
  );
}
