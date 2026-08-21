/**
 * One-way import of storage written before the localStore existed.
 *
 * ESignUI saved the user's signature as a raw data-URL under its own
 * localStorage key, bypassing the persistence layer. Move it into the typed
 * asset store so the signature is visible in /my-stuff and reusable by the
 * watermark and stamp tools, then drop the raw key.
 *
 * Safe to call on every boot: it is idempotent and cheap.
 */
import * as assets from "./assets";

/** The literal key ESignUI has been writing. Singular "privatool" is not a typo. */
export const LEGACY_SIG_KEY = "privatool.esign.savedSig.v1";

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const [, mime, b64] = match;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

export async function migrateLegacyKeys(): Promise<void> {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_SIG_KEY);
  } catch {
    return;
  }
  if (!legacy) return;

  const blob = dataUrlToBlob(legacy);
  if (blob && blob.size > 0 && (await assets.listAssets("signature")).length === 0) {
    try {
      await assets.putAsset("signature", "signature.png", blob);
    } catch {
      /* over quota — drop the legacy key anyway rather than retrying forever */
    }
  }

  try {
    localStorage.removeItem(LEGACY_SIG_KEY);
  } catch {
    /* storage disabled */
  }
}
