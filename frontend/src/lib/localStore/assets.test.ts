import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as assets from "./assets";
import { blobBytes } from "./blobs";

const blobOf = (n: number, type = "image/png") => new Blob([new Uint8Array(n)], { type });

beforeEach(async () => {
  await db.destroy();
});

describe("localStore/assets", () => {
  it("round-trips a blob's bytes", async () => {
    const meta = await assets.putAsset("signature", "mine.png", blobOf(10));
    expect(meta.kind).toBe("signature");
    expect(meta.bytes).toBe(10);
    const back = await assets.getAssetBlob(meta.id);
    expect(back).toBeDefined();
    expect(back!.size).toBe(10);
    expect(back!.type).toBe("image/png");
  });

  it("preserves exact byte content", async () => {
    const payload = new Uint8Array([0, 1, 254, 255, 128]);
    const meta = await assets.putAsset("logo", "l.png", new Blob([payload], { type: "image/png" }));
    const back = await assets.getAssetBlob(meta.id);
    const bytes = new Uint8Array(await blobBytes(back!));
    expect(Array.from(bytes)).toEqual([0, 1, 254, 255, 128]);
  });

  it("lists all assets and filters by kind", async () => {
    await assets.putAsset("signature", "s.png", blobOf(4));
    await assets.putAsset("logo", "l.png", blobOf(4));
    expect(await assets.listAssets()).toHaveLength(2);
    expect((await assets.listAssets("logo")).map((a) => a.name)).toEqual(["l.png"]);
  });

  it("rejects an asset over the per-item cap", async () => {
    await expect(
      assets.putAsset("logo", "big.png", blobOf(assets.MAX_ASSET_BYTES + 1)),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a write that would exceed the total cap", async () => {
    const chunk = assets.MAX_ASSET_BYTES;
    for (let i = 0; i < 5; i++) {
      await assets.putAsset("logo", `l${i}.png`, blobOf(chunk));
    }
    expect(await assets.totalAssetBytes()).toBe(assets.MAX_TOTAL_BYTES);
    await expect(assets.putAsset("logo", "one-more.png", blobOf(1))).rejects.toThrow(
      /storage is full/i,
    );
  });

  it("rejects an empty blob", async () => {
    await expect(assets.putAsset("logo", "empty.png", blobOf(0))).rejects.toThrow(/empty/i);
  });

  it("deletes an asset and frees its budget", async () => {
    const m = await assets.putAsset("logo", "l.png", blobOf(100));
    await assets.deleteAsset(m.id);
    expect(await assets.listAssets()).toEqual([]);
    expect(await assets.totalAssetBytes()).toBe(0);
  });

  it("replaces the single asset of a singleton kind", async () => {
    await assets.putAsset("signature", "old.png", blobOf(10));
    await assets.putAsset("signature", "new.png", blobOf(20));
    const list = await assets.listAssets("signature");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("new.png");
  });

  it("does not return a blob for a missing id", async () => {
    expect(await assets.getAssetBlob("nope")).toBeUndefined();
  });
});
