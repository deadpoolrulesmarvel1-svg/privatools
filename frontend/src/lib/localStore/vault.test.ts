import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as crypt from "./crypto";
import * as vault from "./vault";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

describe("localStore/vault", () => {
  it("adds and lists an entry without exposing the password", async () => {
    const meta = await vault.addPassword("work docs", "hunter2");
    expect(meta.label).toBe("work docs");
    expect(JSON.stringify(meta)).not.toContain("hunter2");

    const list = await vault.listEntries();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("hunter2");
  });

  it("stores ciphertext, never plaintext, at rest", async () => {
    await vault.addPassword("work", "hunter2");
    const raw = await db.values<Record<string, unknown>>("vault");
    const dump = raw
      .map((r) => new TextDecoder().decode(new Uint8Array(r.ct as ArrayBuffer)))
      .join("");
    expect(dump).not.toContain("hunter2");
  });

  it("reveals the password on explicit request", async () => {
    const meta = await vault.addPassword("work", "hunter2");
    expect(await vault.revealPassword(meta.id)).toBe("hunter2");
  });

  it("rejects an empty password", async () => {
    await expect(vault.addPassword("x", "")).rejects.toThrow(/empty/i);
  });

  it("deduplicates by password, keeping the newer label", async () => {
    await vault.addPassword("old label", "same");
    await vault.addPassword("new label", "same");
    const list = await vault.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("new label");
  });

  it("orders candidates most-recently-used first", async () => {
    const a = await vault.addPassword("a", "pw-a");
    const b = await vault.addPassword("b", "pw-b");
    await vault.markUsed(a.id);
    const cands = await vault.candidatesByRecency();
    expect(cands.map((c) => c.password)).toEqual(["pw-a", "pw-b"]);
    expect(b.id).toBeTruthy();
  });

  it("bumps lastUsedAt and useCount only via markUsed", async () => {
    const m = await vault.addPassword("a", "pw");
    expect(m.useCount).toBe(0);
    await vault.markUsed(m.id);
    const [after] = await vault.listEntries();
    expect(after.useCount).toBe(1);
    expect(after.lastUsedAt).toBeGreaterThanOrEqual(m.lastUsedAt);
  });

  it("deletes one entry", async () => {
    const a = await vault.addPassword("a", "pw-a");
    await vault.addPassword("b", "pw-b");
    await vault.deleteEntry(a.id);
    const list = await vault.listEntries();
    expect(list.map((e) => e.label)).toEqual(["b"]);
  });

  it("clears the whole vault", async () => {
    await vault.addPassword("a", "pw-a");
    await vault.clearVault();
    expect(await vault.listEntries()).toEqual([]);
  });

  it("reports entries it cannot decrypt instead of throwing", async () => {
    await vault.addPassword("good", "pw");
    await db.put("vault", "corrupt", {
      id: "corrupt",
      label: "broken",
      iv: new Uint8Array(12),
      ct: new Uint8Array([1, 2, 3]).buffer,
      createdAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
    });
    const cands = await vault.candidatesByRecency();
    expect(cands.map((c) => c.password)).toEqual(["pw"]);
    expect(await vault.unreadableCount()).toBe(1);
  });
});
