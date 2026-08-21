import { beforeEach, describe, expect, it } from "vitest";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { eraseEverything } from "@/lib/localStore/inventory";
import { clearKey, getKey, listConfigured, saveKey, setSessionOnly } from "./keyStore";

beforeEach(async () => {
  _resetForTests();
  await setSessionOnly(false);
  await db.clear("secrets");
});

describe("keyStore", () => {
  it("round-trips a key", async () => {
    await saveKey("anthropic", "sk-ant-secret-value-here");
    expect(await getKey("anthropic")).toBe("sk-ant-secret-value-here");
  });

  it("never writes the plaintext key to storage", async () => {
    await saveKey("openai", "sk-plaintext-must-not-appear");
    const raw = JSON.stringify(await db.values("secrets"));
    expect(raw).not.toContain("sk-plaintext-must-not-appear");
  });

  it("session-only mode keeps the key out of IndexedDB entirely", async () => {
    await setSessionOnly(true);
    await saveKey("openai", "sk-session-only-value");
    expect(await getKey("openai")).toBe("sk-session-only-value");
    expect(await db.keys("secrets")).toHaveLength(0);
  });

  it("clearKey removes it", async () => {
    await saveKey("groq", "gsk_test_value_here");
    await clearKey("groq");
    expect(await getKey("groq")).toBeUndefined();
  });

  it("listConfigured reports which providers have a key, never the key", async () => {
    await saveKey("anthropic", "sk-ant-abc-secret");
    const list = await listConfigured();
    expect(list).toContain("anthropic");
    expect(JSON.stringify(list)).not.toContain("sk-ant-abc-secret");
  });

  it("eraseEverything() removes stored keys", async () => {
    await saveKey("openai", "sk-doomed-value-here");
    await eraseEverything();
    expect(await getKey("openai")).toBeUndefined();
  });

  it("an unreadable ciphertext reads as absent, not an error", async () => {
    // Happens for real: cleared site data, or a different browser profile,
    // leaves ciphertext whose wrapping key is gone. Throwing here would break
    // the whole page instead of just prompting for the key again.
    await db.put("secrets", "byok:openai", { iv: [1, 2, 3], ct: [4, 5, 6] });
    expect(await getKey("openai")).toBeUndefined();
  });
});
