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

function isValidPreset(preset: unknown): preset is StrategyPreset {
  if (!preset || typeof preset !== "object") return false;
  const p = preset as StrategyPreset;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.createdAt === "string" &&
    p.parameters &&
    typeof p.parameters === "object"
  );
}

function assertStorageAvailable(): void {
  if (!browser?.storage?.local) {
    throw new Error("Browser storage is unavailable.");
  }
}

async function readStore(): Promise<PresetStore> {
  assertStorageAvailable();

  const stored = await browser.storage.local.get(STORAGE_KEY);
  const raw = stored?.[STORAGE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw as PresetStore)
      .filter(([, presets]) => Array.isArray(presets))
      .map(([strategyId, presets]) => [
        strategyId,
        presets.filter(isValidPreset).map((p) => ({ ...p, strategyId: p.strategyId ?? strategyId })),
      ]),
  );
}

async function writeStore(store: PresetStore): Promise<void> {
  assertStorageAvailable();
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
