/**
 * The user's saved signature, as a data URL.
 *
 * ESignUI works in data URLs (canvas `toDataURL`, FileReader `readAsDataURL`),
 * while the asset store works in Blobs. This module is the seam: it keeps the
 * tool's ergonomics and the store's typed, quota-bounded, /my-stuff-visible
 * storage, without either side knowing about the other's format.
 *
 * Moving the signature here is what lets the watermark and stamp tools reuse
 * it — previously it was locked inside ESignUI's own localStorage key.
 */
import * as assets from "./localStore/assets";
import { blobBytes } from "./localStore/blobs";
import { migrateLegacyKeys } from "./localStore/migrate";

const KIND = "signature" as const;

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

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // Chunked so a large signature can't blow the argument limit of fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** The saved signature as a data URL, or null. Migrates the legacy key first. */
export async function loadSignature(): Promise<string | null> {
  try {
    await migrateLegacyKeys();
    const [meta] = await assets.listAssets(KIND);
    if (!meta) return null;
    const blob = await assets.getAssetBlob(meta.id);
    if (!blob) return null;
    return `data:${meta.mime};base64,${toBase64(await blobBytes(blob))}`;
  } catch {
    return null;
  }
}

/** Replaces any existing signature — this kind is a singleton in the store. */
export async function saveSignature(dataUrl: string): Promise<boolean> {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob || blob.size === 0) return false;
  try {
    await assets.putAsset(KIND, "signature.png", blob);
    return true;
  } catch {
    // Over quota or storage unavailable. The tool keeps working with the
    // in-memory signature; it just won't survive a reload.
    return false;
  }
}

export async function forgetSignature(): Promise<void> {
  try {
    for (const meta of await assets.listAssets(KIND)) {
      await assets.deleteAsset(meta.id);
    }
  } catch {
    /* storage unavailable — nothing was saved anyway */
  }
}
