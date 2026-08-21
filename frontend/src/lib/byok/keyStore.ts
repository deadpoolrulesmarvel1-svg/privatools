/**
 * Where the user's API key lives.
 *
 * Encrypted at rest with the same non-extractable AES-GCM wrapping key the
 * password vault uses. The honest limit, which the UI must repeat rather than
 * paper over: the API key itself CANNOT be non-extractable, because it has to
 * be readable to go into an auth header. Encrypted on disk; plaintext in
 * memory during a call. That is a real difference from the password vault,
 * where even fully compromised page JS cannot read a stored password.
 *
 * Session-only mode never touches IndexedDB at all — for borrowed machines.
 * It is not the default because forcing a re-paste on every reload makes the
 * feature annoying enough to go unused, and an unused control protects nobody.
 */

import { decryptString, encryptString, type Encrypted } from "@/lib/localStore/crypto";
import * as db from "@/lib/localStore/db";
import { forgetSecret, registerSecret } from "./redact";

const PREFIX = "byok:";
let sessionOnly = false;
const sessionKeys = new Map<string, string>();

export async function setSessionOnly(on: boolean): Promise<void> {
    sessionOnly = on;
    if (on) {
        // Awaited, not fire-and-forget: switching to session-only must finish
        // removing the persisted key before anything can report that nothing
        // is stored. A `void db.clear()` here races the single guarantee this
        // mode exists to provide.
        await db.clear("secrets");
    } else {
        sessionKeys.clear();
    }
}

export function isSessionOnly(): boolean {
    return sessionOnly;
}

export async function saveKey(providerId: string, apiKey: string): Promise<void> {
    registerSecret(apiKey);
    if (sessionOnly) {
        sessionKeys.set(providerId, apiKey);
        return;
    }
    const enc = await encryptString(apiKey);
    await db.put("secrets", PREFIX + providerId, enc);
}

export async function getKey(providerId: string): Promise<string | undefined> {
    if (sessionOnly) return sessionKeys.get(providerId);
    const enc = await db.get<Encrypted>("secrets", PREFIX + providerId);
    if (!enc) return undefined;
    try {
        const plain = await decryptString(enc);
        registerSecret(plain);
        return plain;
    } catch {
        // Wrapping key gone (cleared site data, different browser profile) —
        // the ciphertext is unreadable, so treat it as absent. Throwing would
        // break the page rather than just prompting for the key again.
        return undefined;
    }
}

export async function clearKey(providerId: string): Promise<void> {
    const existing = sessionKeys.get(providerId);
    if (existing) forgetSecret(existing);
    sessionKeys.delete(providerId);
    await db.del("secrets", PREFIX + providerId);
}

/** Provider ids that have a key. Never returns key material. */
export async function listConfigured(): Promise<string[]> {
    if (sessionOnly) return [...sessionKeys.keys()];
    const keys = await db.keys("secrets");
    return keys.filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}
