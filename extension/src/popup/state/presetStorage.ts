import browser from "webextension-polyfill";

const STORAGE_KEY = "tv-optimiser.presets";

export interface StrategyPresetParameter {
  enabled: boolean;
  min?: string;
  max?: string;
}

export interface StrategyPreset {
  id: string;
  strategyId: string;
  name: string;
  createdAt: string;
  parameters: Record<string, StrategyPresetParameter>;
}

type PresetStore = Record<string, StrategyPreset[]>;

async function readStore(): Promise<PresetStore> {
  if (!browser?.storage?.local) {
    return {};
  }
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const raw = stored?.[STORAGE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as PresetStore;
}

async function writeStore(store: PresetStore): Promise<void> {
  if (!browser?.storage?.local) {
    throw new Error("Browser storage is unavailable.");
  }
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

export async function loadStrategyPresets(strategyId: string): Promise<StrategyPreset[]> {
  if (!strategyId) return [];
  const store = await readStore();
  return store[strategyId] ?? [];
}

export async function persistStrategyPreset(preset: StrategyPreset): Promise<StrategyPreset[]> {
  const store = await readStore();
  const existing = store[preset.strategyId] ?? [];
  store[preset.strategyId] = [preset, ...existing.filter((p) => p.id !== preset.id)];
  await writeStore(store);
  return store[preset.strategyId];
}

export async function deleteStrategyPreset(strategyId: string, presetId: string): Promise<StrategyPreset[]> {
  if (!strategyId) return [];
  const store = await readStore();
  store[strategyId] = (store[strategyId] ?? []).filter((p) => p.id !== presetId);
  await writeStore(store);
  return store[strategyId];
}

