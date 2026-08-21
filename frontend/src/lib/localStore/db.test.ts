import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";

beforeEach(async () => {
  await db.destroy();
});

describe("localStore/db", () => {
  it("reports availability", () => {
    expect(db.isAvailable()).toBe(true);
  });

  it("round-trips a value", async () => {
    await db.put("kv", "greeting", { hello: "world" });
    expect(await db.get<{ hello: string }>("kv", "greeting")).toEqual({ hello: "world" });
  });

  it("returns undefined for a missing key", async () => {
    expect(await db.get("kv", "nope")).toBeUndefined();
  });

  it("overwrites on repeated put", async () => {
    await db.put("kv", "n", 1);
    await db.put("kv", "n", 2);
    expect(await db.get("kv", "n")).toBe(2);
  });

  it("deletes a key", async () => {
    await db.put("kv", "gone", true);
    await db.del("kv", "gone");
    expect(await db.get("kv", "gone")).toBeUndefined();
  });

  it("lists keys and values for one store only", async () => {
    await db.put("kv", "a", 1);
    await db.put("kv", "b", 2);
    await db.put("vault", "v1", { secret: true });
    expect((await db.keys("kv")).sort()).toEqual(["a", "b"]);
    expect((await db.values<number>("kv")).sort()).toEqual([1, 2]);
    expect(await db.keys("vault")).toEqual(["v1"]);
  });

  it("clears one store without touching another", async () => {
    await db.put("kv", "a", 1);
    await db.put("vault", "v1", 1);
    await db.clear("kv");
    expect(await db.keys("kv")).toEqual([]);
    expect(await db.keys("vault")).toEqual(["v1"]);
  });

  it("destroy removes everything", async () => {
    await db.put("kv", "a", 1);
    await db.destroy();
    expect(await db.keys("kv")).toEqual([]);
  });

  // Binary is stored as ArrayBuffer, not Blob. Blob-in-IndexedDB has a real
  // bug history (Safari < 14) and does not survive fake-indexeddb's structured
  // clone at all, so assets.ts stores bytes + mime and rebuilds the Blob on
  // read. Assert on CONTENT rather than `instanceof`: vitest reconstructs
  // typed arrays in a different realm, so a cross-realm `instanceof` fails
  // even though the bytes are intact.
  it("stores binary as ArrayBuffer with bytes intact", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await db.put("assets", "b", bytes.buffer);
    const back = await db.get<ArrayBuffer>("assets", "b");
    expect(back).toBeDefined();
    expect(Array.from(new Uint8Array(back!))).toEqual([1, 2, 3, 250]);
  });

  it("round-trips a CryptoKey usably", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await db.put("secrets", "k", key);
    const back = await db.get<CryptoKey>("secrets", "k");
    expect(back).toBeDefined();

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, back!, new TextEncoder().encode("hi"));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    expect(new TextDecoder().decode(plain)).toBe("hi");
  });
});
