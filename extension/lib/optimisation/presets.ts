import {
  cloneOptimisationDraft,
  normaliseOptimisationDraft,
  type OptimisationDraft,
} from './draft';
import type { ParameterConfig } from './parameter-config';

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

export interface SaveOptimisationPreset {
  name: string;
  strategyName: string;
  strategySignature: string;
  parameterConfigs: Record<string, ParameterConfig>;
  draft: OptimisationDraft;
}

const PRESETS_KEY = 'strategyOptimisationPresetsV1';

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value);

const normalisePreset = (
  value: unknown,
): SavedOptimisationPreset | null => {
  if (!isRecord(value)) return null;

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.strategyName !== 'string' ||
    typeof value.strategySignature !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !isRecord(value.parameterConfigs)
  ) {
    return null;
  }

  const version = value.version;

  if (
    version === 2 &&
    !isRecord(value.draft)
  ) {
    return null;
  }

  const draftSource =
    version === 2
      ? value.draft
      : version === 1
        ? value
        : null;

  if (draftSource === null) {
    return null;
  }

  // The map is reconciled against the current TradingView input model before
  // use, which supplies defaults for missing/new fields and drops unknown IDs.
  const parameterConfigs =
    value.parameterConfigs as Record<
      string,
      ParameterConfig
    >;

  return {
    version: 2,
    id: value.id,
    name: value.name,
    strategyName: value.strategyName,
    strategySignature:
      value.strategySignature,
    parameterConfigs,
    draft:
      normaliseOptimisationDraft(
        draftSource,
      ),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const readAllPresets =
  async (): Promise<
    SavedOptimisationPreset[]
  > => {
    const stored =
      await browser.storage.local.get(
        PRESETS_KEY,
      );
    const value = stored[PRESETS_KEY];

    if (!Array.isArray(value)) return [];

    const presets: SavedOptimisationPreset[] =
      [];

    for (const item of value) {
      const preset = normalisePreset(item);
      if (preset) presets.push(preset);
    }

    return presets;
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
      (preset) =>
        preset.strategySignature ===
        strategySignature,
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt,
    );
};

export const saveStrategyPreset = async (
  preset: SaveOptimisationPreset,
): Promise<SavedOptimisationPreset> => {
  const name = preset.name.trim();
  if (!name) {
    throw new Error(
      'Configuration name is required',
    );
  }

  const presets = await readAllPresets();
  const existing = presets.find(
    (item) =>
      item.strategySignature ===
        preset.strategySignature &&
      item.name.toLocaleLowerCase() ===
        name.toLocaleLowerCase(),
  );

  const now = Date.now();
  const saved: SavedOptimisationPreset = {
    version: 2,
    id:
      existing?.id ??
      crypto.randomUUID(),
    name,
    strategyName:
      preset.strategyName,
    strategySignature:
      preset.strategySignature,
    parameterConfigs:
      preset.parameterConfigs,
    draft: cloneOptimisationDraft(
      preset.draft,
    ),
    createdAt:
      existing?.createdAt ?? now,
    updatedAt: now,
  };

  const next = existing
    ? presets.map((item) =>
        item.id === existing.id
          ? saved
          : item,
      )
    : [...presets, saved];

  await writeAllPresets(next);
  return saved;
};

export const deleteStrategyPreset =
  async (
    presetId: string,
  ): Promise<void> => {
    const presets = await readAllPresets();

    await writeAllPresets(
      presets.filter(
        (preset) =>
          preset.id !== presetId,
      ),
    );
  };
