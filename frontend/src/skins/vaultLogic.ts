/**
 * Vault state shared by every skin's extension.
 *
 * Wraps the real device-local vault (lib/localStore/vault) — AES-GCM under a
 * key generated non-extractable, so the raw key can never be read out of the
 * browser. That is materially different from what the imported designs
 * simulate: all three ship a vault backed by plain localStorage and carry a
 * "protection is simulated, do not enter real passwords" notice. Wiring this in
 * is what lets those notices come off.
 *
 * It also means the designs' "protection level" chooser (device / PIN /
 * passphrase) has nothing to map onto. The real model is simpler and stronger:
 * the key is bound to this browser profile and cannot leave it. The surfaces
 * built here say that instead of inventing a chooser.
 */
import { vault } from "@/lib/localStore";

export interface VaultRow {
    id: string;
    label: string;
    createdAt: number;
    lastUsedAt: number;
    useCount: number;
}

export interface VaultState {
    entries: VaultRow[];
    /** id of the entry currently revealed, if any. */
    revealedId: string;
    revealedValue: string;
    label: string;
    password: string;
    busy: boolean;
    error: string;
    /** Entries that failed to decrypt — a key mismatch, not corruption we caused. */
    unreadable: number;
    confirmingClear: boolean;
}

export const initialVaultState: VaultState = {
    entries: [], revealedId: "", revealedValue: "", label: "", password: "",
    busy: false, error: "", unreadable: 0, confirmingClear: false,
};

export const vaultApi = {
    async load(): Promise<{ entries: VaultRow[]; unreadable: number }> {
        const [entries, unreadable] = await Promise.all([
            vault.listEntries(),
            vault.unreadableCount(),
        ]);
        return { entries: entries as VaultRow[], unreadable };
    },
    add: (label: string, password: string) => vault.addPassword(label, password),
    reveal: (id: string) => vault.revealPassword(id),
    remove: (id: string) => vault.deleteEntry(id),
    clear: () => vault.clearVault(),
};

/** Short, human description of an entry for a list row. */
export function describeEntry(row: VaultRow): string {
    const created = new Date(row.createdAt).toISOString().slice(0, 10);
    if (!row.useCount) return `Never used · added ${created}`;
    const used = new Date(row.lastUsedAt).toISOString().slice(0, 10);
    return `Used ${row.useCount}× · last ${used}`;
}
