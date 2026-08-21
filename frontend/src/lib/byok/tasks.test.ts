import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeWithByok, MAX_CHARS_PER_CALL } from "./tasks";

afterEach(() => vi.restoreAllMocks());

function mockOk(text: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
  } as unknown as Response);
}

const ARGS = { providerId: "anthropic", apiKey: "sk-ant-a-real-looking-key", model: "m" };

describe("summarizeWithByok", () => {
  it("returns the model's summary", async () => {
    mockOk("A short summary.");
    const out = await summarizeWithByok({ ...ARGS, text: "some document text", length: "medium" });
    expect(out).toBe("A short summary.");
  });

  it("sends the document as the user turn, with the instruction as system", async () => {
    const f = mockOk("x");
    await summarizeWithByok({ ...ARGS, text: "DOCUMENT BODY HERE", length: "short" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toMatch(/summar/i);
    expect(JSON.stringify(body.messages)).toContain("DOCUMENT BODY HERE");
  });

  it("asks for a different length depending on the setting", async () => {
    const f = mockOk("x");
    await summarizeWithByok({ ...ARGS, text: "t", length: "short" });
    await summarizeWithByok({ ...ARGS, text: "t", length: "detailed" });
    const first = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).system;
    const second = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string).system;
    expect(first).not.toBe(second);
  });

  it("splits a document too long for one call and stitches the result", async () => {
    const f = mockOk("part");
    const long = "word ".repeat(MAX_CHARS_PER_CALL); // far over the per-call budget
    const out = await summarizeWithByok({ ...ARGS, text: long, length: "medium" });
    expect(f.mock.calls.length).toBeGreaterThan(1);
    expect(out.length).toBeGreaterThan(0);
  });

  it("reports progress per chunk so a long run is not a frozen screen", async () => {
    mockOk("part");
    const seen: number[] = [];
    const long = "word ".repeat(MAX_CHARS_PER_CALL);
    await summarizeWithByok({
      ...ARGS, text: long, length: "medium",
      onProgress: (done, total) => { seen.push(done); expect(total).toBeGreaterThan(0); },
    });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("propagates a ByokError rather than swallowing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    await expect(summarizeWithByok({ ...ARGS, text: "t", length: "medium" }))
      .rejects.toMatchObject({ kind: "BadKey" });
  });

  it("refuses empty input instead of paying for a pointless call", async () => {
    const f = mockOk("x");
    await expect(summarizeWithByok({ ...ARGS, text: "   ", length: "medium" })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
