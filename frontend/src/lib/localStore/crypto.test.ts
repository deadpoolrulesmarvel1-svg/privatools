import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as c from "./crypto";

beforeEach(async () => {
  await db.destroy();
  c._resetForTests();
});

describe("localStore/crypto", () => {
  it("reports WebCrypto availability", () => {
    expect(c.hasWebCrypto()).toBe(true);
  });

  it("generates a key that cannot be exported", async () => {
    const key = await c.getOrCreateKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("reuses the same key across calls", async () => {
    const a = await c.getOrCreateKey();
    c._resetForTests();
    const b = await c.getOrCreateKey();
    const enc = await c.encryptString("hello", a);
    expect(await c.decryptString(enc, b)).toBe("hello");
  });

  it("round-trips a string", async () => {
    const enc = await c.encryptString("hunter2");
    expect(await c.decryptString(enc)).toBe("hunter2");
  });

  it("does not store the plaintext", async () => {
    const enc = await c.encryptString("hunter2");
    const bytes = new Uint8Array(enc.ct);
    expect(new TextDecoder().decode(bytes)).not.toContain("hunter2");
  });

  it("uses a fresh IV per encryption", async () => {
    const a = await c.encryptString("same");
    const b = await c.encryptString("same");
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  });

  it("fails cleanly when decrypting with the wrong key", async () => {
    const enc = await c.encryptString("secret");
    const other = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await expect(c.decryptString(enc, other as CryptoKey)).rejects.toThrow();
  });

  it("round-trips unicode", async () => {
    const enc = await c.encryptString("пароль-密码-🔐");
    expect(await c.decryptString(enc)).toBe("пароль-密码-🔐");
  });
});
