import browser from "webextension-polyfill";
import type { StrategyMetric } from "@shared/ipc";

const STORAGE_KEY = "tv-optimiser.metric-favourites";

export async function loadFavouriteMetrics(): Promise<StrategyMetric[]> {
  if (!browser?.storage?.local) {
    return [];
  }

  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const raw = stored?.[STORAGE_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((metric): metric is StrategyMetric => typeof metric === "string");
  } catch (error) {
    console.warn("Failed to load favourite metrics", error);
    return [];
  }
}

export async function persistFavouriteMetrics(metrics: StrategyMetric[]): Promise<void> {
  if (!browser?.storage?.local) {
    throw new Error("Browser storage is unavailable.");
  }
  await browser.storage.local.set({ [STORAGE_KEY]: metrics });
}

