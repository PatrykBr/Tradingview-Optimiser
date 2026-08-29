import type { ParameterConfig } from './search-space';
import { defaultParameterConfig } from './search-space';
import type { StrategyInput } from '../tradingview/types';

export interface SavedOptimisationPreset {
  version: 1;
  id: string;
  name: string;
  strategyName: string;
  strategySignature: string;
  parameterConfigs: Record<string, ParameterConfig>;
  objectiveMetric: string;
  targetTrials: string;
  maxDrawdownFilter: {
    enabled: boolean;
    value: string;
  };
  minProfitFactorFilter: {
    enabled: boolean;
    value: string;
  };
  minTradesFilter: {
    enabled: boolean;
    value: string;
  };
  dateRangeEnabled: boolean;
  startDate: string;
  endDate: string;
  createdAt: number;
  updatedAt: number;
}

const PRESETS_KEY = 'strategyOptimisationPresetsV1';

const readAllPresets = async (): Promise<SavedOptimisationPreset[]> => {
  const stored = await browser.storage.local.get(PRESETS_KEY);
  const value = stored[PRESETS_KEY];

  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is SavedOptimisationPreset =>
      item !== null &&
      typeof item === 'object' &&
      (item as Partial<SavedOptimisationPreset>).version === 1 &&
      typeof (item as Partial<SavedOptimisationPreset>).id === 'string' &&
      typeof (item as Partial<SavedOptimisationPreset>).name === 'string' &&
      typeof (item as Partial<SavedOptimisationPreset>).strategySignature ===
        'string',
  );
};

const writeAllPresets = async (
  presets: SavedOptimisationPreset[],
): Promise<void> => {
  await browser.storage.local.set({
    [PRESETS_KEY]: presets,
  });
};

export const loadStrategyPresets = async (
  strategySignature: string,
): Promise<SavedOptimisationPreset[]> => {
  const presets = await readAllPresets();

  return presets
    .filter(
      (preset) => preset.strategySignature === strategySignature,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const saveStrategyPreset = async (
  preset: Omit<
    SavedOptimisationPreset,
    'version' | 'id' | 'createdAt' | 'updatedAt'
  >,
): Promise<SavedOptimisationPreset> => {
  const name = preset.name.trim();
  if (!name) throw new Error('Configuration name is required');

  const presets = await readAllPresets();
  const existing = presets.find(
    (item) =>
      item.strategySignature === preset.strategySignature &&
      item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );

  const now = Date.now();
  const saved: SavedOptimisationPreset = {
    ...preset,
    version: 1,
    id: existing?.id ?? crypto.randomUUID(),
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const next = existing
    ? presets.map((item) => (item.id === existing.id ? saved : item))
    : [...presets, saved];

  await writeAllPresets(next);
  return saved;
};

export const deleteStrategyPreset = async (
  presetId: string,
): Promise<void> => {
  const presets = await readAllPresets();
  await writeAllPresets(
    presets.filter((preset) => preset.id !== presetId),
  );
};

export const reconcilePresetParameterConfigs = (
  inputs: StrategyInput[],
  saved: Record<string, ParameterConfig>,
): Record<string, ParameterConfig> =>
  Object.fromEntries(
    inputs.map((input) => {
      const fallback = defaultParameterConfig(input);
      const stored = saved[input.id];

      if (!stored) return [input.id, fallback];

      return [
        input.id,
        {
          ...fallback,
          ...stored,
          choices: [...stored.choices],
          conditionValues: [...stored.conditionValues],
        },
      ];
    }),
  );
