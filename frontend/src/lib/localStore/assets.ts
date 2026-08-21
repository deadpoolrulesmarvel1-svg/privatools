/**
 * Shared binary assets — signature, logo, watermark, letterhead, stamp.
 *
 * Generalizes what ESignUI already did for signatures alone (a raw
 * localStorage data-URL key) into a typed store the watermark, stamp, and
 * header-footer tools can all read from.
 *
 * Storage is ArrayBuffer + mime, NOT Blob. Blob-in-IndexedDB has a real bug
 * history (Safari < 14 dropped them) and does not survive structured clone in
 * some environments at all; bytes always do. The Blob is rebuilt on read, so
 * callers still work with Blobs.
 *
 * Quotas are explicit and produce a clear error rather than a silent write
 * failure: running out of storage mid-save with no message is worse than a
 * refusal that says why.
 */
import * as db from "./db";

export type AssetKind = "signature" | "logo" | "watermark" | "letterhead" | "stamp";

/** Kinds where a second asset replaces the first rather than accumulating. */
const SINGLETON_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(["signature", "letterhead"]);

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  bytes: number;
  createdAt: number;
}

interface AssetRecord extends AssetMeta {
  data: ArrayBuffer;
}

function toMeta(r: AssetRecord): AssetMeta {
  const { data: _data, ...meta } = r;
  return meta;
}

function isRecord(v: unknown): v is AssetRecord {
  return !!v && typeof v === "object" && typeof (v as AssetRecord).kind === "string";
}

/**
 * Read a Blob's bytes. `Blob.arrayBuffer()` is missing in Safari < 14 (and in
 * jsdom), so fall back to FileReader, which is universally available.
 */
function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsArrayBuffer(blob);
  });
}

async function records(): Promise<AssetRecord[]> {
  return (await db.values<unknown>("assets")).filter(isRecord);
}

export async function totalAssetBytes(): Promise<number> {
  return (await records()).reduce((sum, r) => sum + r.bytes, 0);
}

export async function putAsset(kind: AssetKind, name: string, blob: Blob): Promise<AssetMeta> {
  if (blob.size === 0) throw new Error("That file is empty.");
  if (blob.size > MAX_ASSET_BYTES) {
    throw new Error(
      `That file is too large — the limit is ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB per item.`,
    );
  }

  const existing = await records();
  const replacing = SINGLETON_KINDS.has(kind) ? existing.filter((r) => r.kind === kind) : [];
  const freed = replacing.reduce((sum, r) => sum + r.bytes, 0);
  const used = existing.reduce((sum, r) => sum + r.bytes, 0) - freed;

  if (used + blob.size > MAX_TOTAL_BYTES) {
    throw new Error(
      `Your device storage is full — the limit is ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB total. Delete something first.`,
    );
  }

  for (const r of replacing) await db.del("assets", r.id);

  const record: AssetRecord = {
    id: crypto.randomUUID(),
    kind,
    name: name || "untitled",
    mime: blob.type || "application/octet-stream",
    bytes: blob.size,
    createdAt: Date.now(),
    data: await blobBytes(blob),
  };
  await db.put("assets", record.id, record);
  return toMeta(record);
}

export async function listAssets(kind?: AssetKind): Promise<AssetMeta[]> {
  const all = await records();
  return all
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toMeta);
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  const record = await db.get<AssetRecord>("assets", id);
  if (!record || !isRecord(record)) return undefined;
  // Copy through a fresh Uint8Array — a value read back from IndexedDB can be
  // a cross-realm typed array, which some Blob implementations reject.
  return new Blob([new Uint8Array(record.data)], { type: record.mime });
}

export async function deleteAsset(id: string): Promise<void> {
  await db.del("assets", id);
}

export async function clearAssets(): Promise<void> {
  await db.clear("assets");
}

/** Test hook — exposes the Blob-reading fallback so tests don't depend on
 *  `Blob.arrayBuffer()` being present in the environment. */
export const _blobBytesForTests = blobBytes;
