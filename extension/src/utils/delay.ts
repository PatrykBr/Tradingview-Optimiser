import type { AntiDetectionConfig } from '../shared/types';

/**
 * Returns a random delay between min and max (inclusive).
 */
export function getRandomDelay(config: AntiDetectionConfig): number {
  if (!config.enabled) return 0;
  const min = Math.min(config.minDelay, config.maxDelay);
  const max = Math.max(config.minDelay, config.maxDelay);
  return min + Math.random() * (max - min);
}

/**
 * Sleeps for a random delay based on anti-detection config.
 */
export async function randomDelay(config: AntiDetectionConfig): Promise<void> {
  const delay = getRandomDelay(config);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Sleeps for a fixed number of milliseconds.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
