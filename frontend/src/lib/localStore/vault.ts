/**
 * Device-local password vault.
 *
 * Entries hold only ciphertext. `label` is a user-supplied nickname and is
 * stored in plaintext — the UI warns against putting the password in it.
 *
 * Candidate ordering is most-recently-used first, which is the best available
 * heuristic without fingerprinting documents. We deliberately do NOT store a
 * hash of the PDF to remember which password opened it: that would be a privacy
 * regression (a stable identifier for a user's documents) for a marginal
 * speed-up on a loop that runs in milliseconds.
 */
import * as db from "./db";
import { decryptString, encryptString, type Encrypted } from "./crypto";

export interface VaultEntry extends Encrypted {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

export type VaultEntryMeta = Omit<VaultEntry, "iv" | "ct">;

function toMeta(e: VaultEntry): VaultEntryMeta {
  const { iv: _iv, ct: _ct, ...meta } = e;
  return meta;
}

async function all(): Promise<VaultEntry[]> {
  return db.values<VaultEntry>("vault");
}

/** Decrypt every entry, skipping any that fail. Returns the readable ones. */
async function readable(): Promise<{ entry: VaultEntry; password: string }[]> {
  const out: { entry: VaultEntry; password: string }[] = [];
  for (const entry of await all()) {
    try {
      out.push({ entry, password: await decryptString({ iv: entry.iv, ct: entry.ct }) });
    } catch {
      /* corrupt or key-mismatched — surfaced via unreadableCount() */
    }
  }
  return out;
}

export async function addPassword(label: string, password: string): Promise<VaultEntryMeta> {
  if (!password) throw new Error("Password cannot be empty");

  // Dedupe: the same password saved twice would be tried twice for no gain.
  // Keep the newer label so a re-save can rename.
  for (const { entry, password: existing } of await readable()) {
    if (existing === password) {
      const updated: VaultEntry = { ...entry, label: label || entry.label };
      await db.put("vault", updated.id, updated);
      return toMeta(updated);
    }
  }

  const enc = await encryptString(password);
  const entry: VaultEntry = {
    id: crypto.randomUUID(),
    label: label || "Untitled",
    iv: enc.iv,
    ct: enc.ct,
    createdAt: Date.now(),
    lastUsedAt: 0,
    useCount: 0,
  };
  await db.put("vault", entry.id, entry);
  return toMeta(entry);
}

/** Metadata only, most-recently-used first. Never returns passwords. */
export async function listEntries(): Promise<VaultEntryMeta[]> {
  const entries = await all();
  entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt);
  return entries.map(toMeta);
}

export async function revealPassword(id: string): Promise<string> {
  const entry = await db.get<VaultEntry>("vault", id);
  if (!entry) throw new Error("No such vault entry");
  return decryptString({ iv: entry.iv, ct: entry.ct });
}

/** Decrypted candidates for a trial run, most-recently-used first. */
export async function candidatesByRecency(): Promise<{ id: string; password: string }[]> {
  const items = await readable();
  items.sort(
    (a, b) => b.entry.lastUsedAt - a.entry.lastUsedAt || b.entry.createdAt - a.entry.createdAt,
  );
  return items.map(({ entry, password }) => ({ id: entry.id, password }));
}

export async function unreadableCount(): Promise<number> {
  return (await all()).length - (await readable()).length;
}

export async function markUsed(id: string): Promise<void> {
  const entry = await db.get<VaultEntry>("vault", id);
  if (!entry) return;
  await db.put("vault", id, {
    ...entry,
    lastUsedAt: Date.now(),
    useCount: entry.useCount + 1,
  });
}

export async function deleteEntry(id: string): Promise<void> {
  await db.del("vault", id);
}

export async function clearVault(): Promise<void> {
  await db.clear("vault");
}
