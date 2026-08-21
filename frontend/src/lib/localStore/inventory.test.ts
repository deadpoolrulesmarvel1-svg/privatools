import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as crypt from "./crypto";
import * as vault from "./vault";
import * as assets from "./assets";
import * as counters from "./counters";
import * as defaults from "./defaults";
import { eraseEverything, exportSetup, inventory } from "./inventory";
import { blobText } from "./blobs";
import { savePersisted } from "@/lib/persistence";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
  localStorage.clear();
});

describe("localStore/inventory", () => {
  it("reports an empty store", async () => {
    const inv = await inventory();
    expect(inv.vault.count).toBe(0);
    expect(inv.assets.count).toBe(0);
    expect(inv.assets.bytes).toBe(0);
    expect(inv.counters.count).toBe(0);
    expect(inv.defaults.count).toBe(0);
    expect(inv.isEmpty).toBe(true);
  });

  it("counts everything stored", async () => {
    await vault.addPassword("a", "pw");
    await assets.putAsset("logo", "l.png", new Blob([new Uint8Array(64)]));
    await counters.createCounter({ name: "M" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");

    const inv = await inventory();
    expect(inv.vault.count).toBe(1);
    expect(inv.assets.count).toBe(1);
    expect(inv.assets.bytes).toBe(64);
    expect(inv.counters.count).toBe(1);
    expect(inv.defaults.count).toBe(1);
    expect(inv.isEmpty).toBe(false);
  });

  it("reports the active counter's next label", async () => {
    await counters.createCounter({ name: "Smith", prefix: "SMITH-", digits: 6, next: 412 });
    expect((await inventory()).counters.activeLabel).toBe("SMITH-000412");
  });

  it("export excludes the vault entirely", async () => {
    await vault.addPassword("secret label", "hunter2");
    await counters.createCounter({ name: "M", prefix: "M-" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");

    const text = await blobText(await exportSetup());
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret label");
    expect(text).toContain("M-");
    expect(text).toContain("extreme");

    const parsed = JSON.parse(text);
    expect(parsed.vault).toBeUndefined();
    expect(parsed.note).toMatch(/vault/i);
  });

  it("eraseEverything leaves nothing behind", async () => {
    await vault.addPassword("a", "pw");
    await assets.putAsset("logo", "l.png", new Blob([new Uint8Array(8)]));
    await counters.createCounter({ name: "M" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    localStorage.setItem("privatools_form_other", "x");

    await eraseEverything();

    const inv = await inventory();
    expect(inv.vault.count).toBe(0);
    expect(inv.assets.count).toBe(0);
    expect(inv.counters.count).toBe(0);
    expect(inv.defaults.count).toBe(0);
    expect(localStorage.getItem("privatools_form_other")).toBeNull();
  });

  it("erases the legacy singular-prefix keys too", async () => {
    // ESignUI's key is "privatool." (singular) — a naive "privatools" prefix
    // filter would leave the user's signature on the device after they asked
    // for everything to be erased.
    localStorage.setItem("privatool.esign.savedSig.v1", "data:image/png;base64,AAA");
    await eraseEverything();
    expect(localStorage.getItem("privatool.esign.savedSig.v1")).toBeNull();
  });

  it("preserves the analytics opt-out", async () => {
    // This is a privacy PREFERENCE, not stored user data. Erasing it would
    // silently re-enable the analytics beacon for someone who opted out.
    localStorage.setItem("pt-analytics-opt-out", "1");
    localStorage.setItem("privatools_theme", "dark");
    await eraseEverything();
    expect(localStorage.getItem("pt-analytics-opt-out")).toBe("1");
    expect(localStorage.getItem("privatools_theme")).toBeNull();
  });

  it("reports environment capability", async () => {
    const inv = await inventory();
    expect(inv.available.indexedDb).toBe(true);
    expect(inv.available.webCrypto).toBe(true);
  });
});
