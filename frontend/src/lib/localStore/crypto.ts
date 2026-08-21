/**
 * Vault encryption.
 *
 * Passwords are encrypted with AES-GCM under a key generated as
 * NON-EXTRACTABLE (`extractable: false`). The browser will hand the page a
 * handle to the key and will encrypt/decrypt with it, but `exportKey` rejects —
 * the raw bytes can never be read out, copied to another device, or exfiltrated
 * by a script that dumps storage.
 *
 * What this does NOT protect against: script execution on our own origin (XSS).
 * A compromised page can ask the key to decrypt just as legitimate code does.
 * The real control there is the nonce-based CSP. /my-stuff says so plainly
 * rather than overclaiming.
 *
 * Consequence, deliberately accepted: a non-extractable key cannot leave the
 * device, so the vault can never sync. Everything else in the local store is
 * exportable.
 */
import * as db from "./db";

const KEY_ID = "vault-key";
const IV_BYTES = 12; // AES-GCM standard nonce length

export interface Encrypted {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

let cached: Promise<CryptoKey> | null = null;

export function hasWebCrypto(): boolean {
  try {
    return typeof globalThis.crypto?.subtle?.generateKey === "function";
  } catch {
    return false;
  }
}

/** Test hook — drops the in-process cache so a fresh read from IndexedDB happens. */
export function _resetForTests(): void {
  cached = null;
}

export function getOrCreateKey(): Promise<CryptoKey> {
  if (cached) return cached;
  cached = (async () => {
    const existing = await db.get<CryptoKey>("secrets", KEY_ID);
    // A structured-clone round-trip preserves usability and `extractable: false`.
    if (existing && typeof (existing as CryptoKey).type === "string") return existing;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await db.put("secrets", KEY_ID, key);
    return key;
  })();
  return cached;
}

export async function encryptString(plain: string, key?: CryptoKey): Promise<Encrypted> {
  const k = key ?? (await getOrCreateKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    k,
    new TextEncoder().encode(plain),
  );
  return { iv, ct };
}

export async function decryptString(enc: Encrypted, key?: CryptoKey): Promise<string> {
  const k = key ?? (await getOrCreateKey());
  // Copy the IV through a fresh Uint8Array: a value read back from IndexedDB
  // may be a cross-realm typed array, which WebCrypto rejects.
  const iv = new Uint8Array(enc.iv);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, enc.ct);
  return new TextDecoder().decode(plain);
}
