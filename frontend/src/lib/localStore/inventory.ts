/**
 * What's stored on this device — powers /my-stuff.
 *
 * `exportSetup` deliberately omits the vault: its key is non-extractable, so
 * the passwords cannot be re-imported anywhere anyway. The export says so
 * rather than silently producing an incomplete backup.
 */
import * as db from "./db";
import * as assets from "./assets";
import * as counters from "./counters";
import * as defaults from "./defaults";
import * as vault from "./vault";
import { hasWebCrypto } from "./crypto";

/**
 * Prefixes this site writes to localStorage. Note BOTH spellings: ESignUI's
 * signature key is "privatool." (singular), so a naive "privatools" filter
 * would leave a user's saved signature behind after they asked for everything
 * to be erased.
 */
const LS_PREFIXES = ["privatools", "privatool."] as const;

/**
 * Keys that survive "Erase everything". These are privacy PREFERENCES, not
 * stored user data — wiping the analytics opt-out would silently re-enable the
 * beacon for someone who deliberately turned it off.
 */
const LS_PRESERVE = new Set<string>(["pt-analytics-opt-out"]);

export interface Inventory {
  vault: { count: number; unreadable: number };
  assets: { count: number; bytes: number };
  counters: { count: number; activeLabel: string | null };
  defaults: { count: number; slugs: string[] };
  available: { indexedDb: boolean; webCrypto: boolean };
  /** True when this site has stored nothing at all on the device. */
  isEmpty: boolean;
}

export async function inventory(): Promise<Inventory> {
  const [entries, unreadable, assetList, bytes, counterList, activeId, slugs] =
    await Promise.all([
      vault.listEntries(),
      vault.unreadableCount(),
      assets.listAssets(),
      assets.totalAssetBytes(),
      counters.listCounters(),
      counters.getActiveCounterId(),
      defaults.customizedSlugs(),
    ]);

  const active = counterList.find((c) => c.id === activeId) ?? null;

  return {
    vault: { count: entries.length, unreadable },
    assets: { count: assetList.length, bytes },
    counters: {
      count: counterList.length,
      activeLabel: active ? counters.formatNext(active) : null,
    },
    defaults: { count: slugs.length, slugs },
    available: { indexedDb: db.isAvailable(), webCrypto: hasWebCrypto() },
    isEmpty:
      entries.length === 0 &&
      assetList.length === 0 &&
      counterList.length === 0 &&
      slugs.length === 0,
  };
}

export async function exportSetup(): Promise<Blob> {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note:
      "Your password vault is NOT included. Its encryption key is non-extractable by design and cannot leave the device it was created on.",
    counters: await counters.listCounters(),
    activeCounterId: await counters.getActiveCounterId(),
    assets: await assets.listAssets(),
    defaults: await defaults.exportDefaults(),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

/** Nuke everything this site stored on the device. */
export async function eraseEverything(): Promise<void> {
  await db.destroy();
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || LS_PRESERVE.has(k)) continue;
      if (LS_PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage disabled — nothing was persisted anyway */
  }
}
