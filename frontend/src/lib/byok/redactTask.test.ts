import { afterEach, describe, expect, it, vi } from "vitest";
import { findEntitiesWithByok, maskKnownPii } from "./redactTask";

afterEach(() => vi.restoreAllMocks());

function mockOk(text: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
  } as unknown as Response);
}

const ARGS = { providerId: "anthropic", apiKey: "sk-ant-a-real-looking-key", model: "m" };

describe("maskKnownPii", () => {
  it("replaces already-detected strings with stable placeholders", () => {
    const { masked, map } = maskKnownPii("Call 555-123-4567 or mail a@b.com", ["555-123-4567", "a@b.com"]);
    expect(masked).not.toContain("555-123-4567");
    expect(masked).not.toContain("a@b.com");
    expect(map.size).toBe(2);
  });

  it("masks every occurrence, not just the first", () => {
    const { masked } = maskKnownPii("x 111-22-3333 y 111-22-3333 z", ["111-22-3333"]);
    expect(masked).not.toContain("111-22-3333");
  });

  it("leaves the rest of the text intact so the model still has context", () => {
    const { masked } = maskKnownPii("Dr Alice Smith, SSN 111-22-3333, of Acme Ltd", ["111-22-3333"]);
    expect(masked).toContain("Dr Alice Smith");
    expect(masked).toContain("Acme Ltd");
  });

  it("is a no-op when nothing was detected locally", () => {
    const { masked, map } = maskKnownPii("nothing sensitive here", []);
    expect(masked).toBe("nothing sensitive here");
    expect(map.size).toBe(0);
  });
});

describe("findEntitiesWithByok", () => {
  it("never sends the locally-detected PII to the provider", async () => {
    const f = mockOk(JSON.stringify({ entities: [] }));
    await findEntitiesWithByok({
      ...ARGS,
      text: "Alice Smith SSN 111-22-3333 card 4111111111111111",
      knownPii: ["111-22-3333", "4111111111111111"],
    });
    const sent = (f.mock.calls[0][1] as RequestInit).body as string;
    expect(sent).not.toContain("111-22-3333");
    expect(sent).not.toContain("4111111111111111");
    // …but the surrounding text must survive, or the model has no context.
    expect(sent).toContain("Alice Smith");
  });

  it("returns the entities the model found", async () => {
    mockOk(JSON.stringify({ entities: [{ text: "Alice Smith", type: "PER" }] }));
    const out = await findEntitiesWithByok({ ...ARGS, text: "Alice Smith works here", knownPii: [] });
    expect(out).toEqual([{ text: "Alice Smith", type: "PER" }]);
  });

  it("tolerates the model wrapping JSON in prose or fences", async () => {
    mockOk('Sure! Here you go:\n```json\n{"entities":[{"text":"Acme","type":"ORG"}]}\n```');
    const out = await findEntitiesWithByok({ ...ARGS, text: "Acme", knownPii: [] });
    expect(out).toEqual([{ text: "Acme", type: "ORG" }]);
  });

  it("returns nothing rather than crashing when the model returns junk", async () => {
    mockOk("I cannot help with that.");
    const out = await findEntitiesWithByok({ ...ARGS, text: "x", knownPii: [] });
    expect(out).toEqual([]);
  });

  it("drops any entity that is actually one of our placeholders", async () => {
    // The model sometimes helpfully "finds" the mask itself. Redacting a
    // placeholder would be a no-op at best and a wrong hit at worst.
    mockOk(JSON.stringify({ entities: [{ text: "[REDACTED-1]", type: "MISC" }, { text: "Bob", type: "PER" }] }));
    const out = await findEntitiesWithByok({ ...ARGS, text: "Bob 111-22-3333", knownPii: ["111-22-3333"] });
    expect(out.map(e => e.text)).toEqual(["Bob"]);
  });

  it("propagates a ByokError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    await expect(findEntitiesWithByok({ ...ARGS, text: "x", knownPii: [] }))
      .rejects.toMatchObject({ kind: "RateLimited" });
  });
});
