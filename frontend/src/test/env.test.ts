import { describe, it, expect } from "vitest";

describe("test environment", () => {
  it("provides IndexedDB", () => {
    expect(typeof indexedDB).toBe("object");
    expect(indexedDB).not.toBeNull();
  });

  it("provides WebCrypto subtle", () => {
    expect(globalThis.crypto.subtle).toBeDefined();
    expect(typeof globalThis.crypto.subtle.generateKey).toBe("function");
  });

  it("can generate a non-extractable AES-GCM key", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});
