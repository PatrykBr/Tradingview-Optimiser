import { STORAGE_KEYS } from '../shared/constants';
import type { SavedConfig } from '../shared/types';

/**
 * Get a value from chrome.storage.local
 */
export async function getStorage<T>(key: string): Promise<T | undefined> {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  } catch (err) {
    console.error(`[Storage] Failed to get "${key}":`, err);
    return undefined;
  }
}

/**
 * Set a value in chrome.storage.local
 */
export async function setStorage<T>(key: string, value: T): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error(`[Storage] Failed to set "${key}":`, err);
  }
}

// Typed helpers

export async function getSavedConfigs(): Promise<SavedConfig[]> {
  return (await getStorage<SavedConfig[]>(STORAGE_KEYS.SAVED_CONFIGS)) ?? [];
}

export async function saveConfig(config: SavedConfig): Promise<void> {
  const configs = await getSavedConfigs();
  const index = configs.findIndex((c) => c.id === config.id);
  if (index >= 0) {
    configs[index] = config;
  } else {
    configs.push(config);
  }
  await setStorage(STORAGE_KEYS.SAVED_CONFIGS, configs);
}

export async function deleteConfig(id: string): Promise<void> {
  const configs = await getSavedConfigs();
  await setStorage(
    STORAGE_KEYS.SAVED_CONFIGS,
    configs.filter((c) => c.id !== id),
  );
}
