import type { AntiDetectionConfig } from '../shared/types';

/**
 * Returns a random delay between min and max using the Web Crypto API.
 */
export function getRandomDelay(config: AntiDetectionConfig): number {
  if (!config.enabled) return 0;
  const min = Math.min(config.minDelay, config.maxDelay);
  const max = Math.max(config.minDelay, config.maxDelay);
  const randomValue = new Uint32Array(1);
  globalThis.crypto.getRandomValues(randomValue);
  const randomFraction = randomValue[0] / 0x1_0000_0000;
  return min + randomFraction * (max - min);
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
