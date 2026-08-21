import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as assets from "./assets";
import { LEGACY_SIG_KEY, migrateLegacyKeys } from "./migrate";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("migrateLegacyKeys", () => {
  it("targets the key ESignUI actually writes", () => {
    expect(LEGACY_SIG_KEY).toBe("privatool.esign.savedSig.v1");
  });

  it("does nothing when there is no legacy signature", async () => {
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toEqual([]);
  });

  it("moves a legacy signature into the asset store and removes the raw key", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, PNG_DATA_URL);
    await migrateLegacyKeys();

    const sigs = await assets.listAssets("signature");
    expect(sigs).toHaveLength(1);
    expect(sigs[0].mime).toBe("image/png");
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
  });

  it("is idempotent", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, PNG_DATA_URL);
    await migrateLegacyKeys();
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toHaveLength(1);
  });

  it("does not clobber a signature already in the asset store", async () => {
    await assets.putAsset("signature", "existing.png", new Blob([new Uint8Array(9)]));
    localStorage.setItem(LEGACY_SIG_KEY, PNG_DATA_URL);
    await migrateLegacyKeys();
    const sigs = await assets.listAssets("signature");
    expect(sigs).toHaveLength(1);
    expect(sigs[0].name).toBe("existing.png");
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
  });

  it("ignores a malformed legacy value and clears it", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, "not-a-data-url");
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toEqual([]);
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
  });
});
