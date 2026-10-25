import {
  cloneOptimisationDraft,
  isOptimisationDraft,
  normaliseOptimisationDraft,
  type OptimisationDraft,
} from './draft';
import { isParameterConfig, type ParameterConfig } from './parameter-config';

export interface SavedOptimisationPreset {
  version: 2;
  id: string;
  name: string;
  strategyName: string;
  strategySignature: string;
  parameterConfigs: Record<string, ParameterConfig>;
  draft: OptimisationDraft;
  createdAt: number;
  updatedAt: number;
}

interface SaveOptimisationPreset {
  name: string;
  strategyName: string;
  strategySignature: string;
  parameterConfigs: Record<string, ParameterConfig>;
  draft: OptimisationDraft;
}

const PRESETS_KEY = 'strategyOptimisationPresetsV1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseParameterConfigs = (value: unknown): Record<string, ParameterConfig> => {
  if (!isRecord(value)) {
    throw new Error('Saved configuration parameter settings are corrupted');
  }

  const result: Record<string, ParameterConfig> = {};

  for (const [id, config] of Object.entries(value)) {
    if (!isParameterConfig(config)) {
      throw new Error('Saved configuration contains invalid parameter settings for ' + id);
    }
    result[id] = config;
  }

  return result;
};

const parsePreset = (value: unknown): SavedOptimisationPreset => {
  if (!isRecord(value)) {
    throw new Error('Saved configuration record is corrupted');
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.strategyName !== 'string' ||
    typeof value.strategySignature !== 'string' ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt)
  ) {
    throw new TypeError('Saved configuration metadata is corrupted');
  }

  const parameterConfigs = parseParameterConfigs(value.parameterConfigs);

  let draft: OptimisationDraft;

  if (value.version === 2) {
    if (!isOptimisationDraft(value.draft)) {
      throw new Error('Saved configuration has an invalid v2 draft');
    }
    draft = cloneOptimisationDraft(value.draft);
  } else if (value.version === 1) {
    // v1 stored draft fields on the record itself. Migrate those records once.
    // Reject corrupt current-version records instead of filling in defaults.
    draft = normaliseOptimisationDraft(value);
  } else {
    throw new Error('Saved configuration uses an unsupported version');
  }

  return {
    version: 2,
    id: value.id,
    name: value.name,
    strategyName: value.strategyName,
    strategySignature: value.strategySignature,
    parameterConfigs,
    draft,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const readAllPresets = async (): Promise<SavedOptimisationPreset[]> => {
  const stored = await browser.storage.local.get(PRESETS_KEY);
  const value = stored[PRESETS_KEY];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError('Saved configuration storage is corrupted');
  }

  return value.map(parsePreset);
};

const writeAllPresets = async (presets: SavedOptimisationPreset[]): Promise<void> => {
  await browser.storage.local.set({
    [PRESETS_KEY]: presets,
  });
};

export const loadStrategyPresets = async (
  strategySignature: string,
): Promise<SavedOptimisationPreset[]> => {
  const presets = await readAllPresets();

  return presets
    .filter((preset) => preset.strategySignature === strategySignature)
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const saveStrategyPreset = async (
  preset: SaveOptimisationPreset,
): Promise<SavedOptimisationPreset> => {
  const name = preset.name.trim();
  if (!name) {
    throw new Error('Configuration name is required');
  }

  const presets = await readAllPresets();
  const existing = presets.find(
    (item) =>
      item.strategySignature === preset.strategySignature &&
      item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );

  const now = Date.now();
  const saved: SavedOptimisationPreset = {
    version: 2,
    id: existing?.id ?? crypto.randomUUID(),
    name,
    strategyName: preset.strategyName,
    strategySignature: preset.strategySignature,
    parameterConfigs: preset.parameterConfigs,
    draft: cloneOptimisationDraft(preset.draft),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const next = existing
    ? presets.map((item) => (item.id === existing.id ? saved : item))
    : [...presets, saved];

  await writeAllPresets(next);
  return saved;
};

export const deleteStrategyPreset = async (presetId: string): Promise<void> => {
  const presets = await readAllPresets();

  await writeAllPresets(presets.filter((preset) => preset.id !== presetId));
};
