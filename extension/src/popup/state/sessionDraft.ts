import browser from "webextension-polyfill";

const STORAGE_KEY = "tv-optimiser.session-draft";

type DraftPayload = Record<string, unknown>;

export async function loadSessionDraft<T extends DraftPayload>(): Promise<T | null> {
  if (!browser?.storage?.local) {
    return null;
  }

  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const raw = stored?.[STORAGE_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    return raw as T;
  } catch (error) {
    console.warn("Failed to load optimiser draft state", error);
    return null;
  }
}

export async function persistSessionDraft(draft: DraftPayload): Promise<void> {
  if (!browser?.storage?.local) {
    return;
  }

  try {
    await browser.storage.local.set({ [STORAGE_KEY]: draft });
  } catch (error) {
    console.warn("Failed to persist optimiser draft state", error);
  }
}

