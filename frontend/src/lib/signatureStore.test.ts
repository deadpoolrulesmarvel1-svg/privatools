import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./localStore/db";
import * as assets from "./localStore/assets";
import { LEGACY_SIG_KEY } from "./localStore/migrate";
import { forgetSignature, loadSignature, saveSignature } from "./signatureStore";

// 1x1 transparent PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("signatureStore", () => {
  it("returns null when nothing is saved", async () => {
    expect(await loadSignature()).toBeNull();
  });

  it("round-trips a data URL", async () => {
    expect(await saveSignature(PNG)).toBe(true);
    const back = await loadSignature();
    expect(back).toMatch(/^data:image\/png;base64,/);
    expect(back).toBe(PNG);
  });

  it("stores through the shared asset store so /my-stuff sees it", async () => {
    await saveSignature(PNG);
    const list = await assets.listAssets("signature");
    expect(list).toHaveLength(1);
    expect(list[0].mime).toBe("image/png");
  });

  it("replaces rather than accumulating", async () => {
    await saveSignature(PNG);
    await saveSignature(PNG);
    expect(await assets.listAssets("signature")).toHaveLength(1);
  });

  it("rejects a malformed data URL without throwing", async () => {
    expect(await saveSignature("not-a-data-url")).toBe(false);
    expect(await loadSignature()).toBeNull();
  });

  it("forgets the signature", async () => {
    await saveSignature(PNG);
    await forgetSignature();
    expect(await loadSignature()).toBeNull();
    expect(await assets.listAssets("signature")).toEqual([]);
  });

  it("picks up a signature saved by the previous localStorage-based version", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, PNG);
    const back = await loadSignature();
    expect(back).toBe(PNG);
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
    expect(await assets.listAssets("signature")).toHaveLength(1);
  });
});
