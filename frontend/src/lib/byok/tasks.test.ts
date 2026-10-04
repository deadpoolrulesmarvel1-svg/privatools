import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeWithByok, MAX_CHARS_PER_CALL, NumberedReplyError, translateLinesWithByok } from "./tasks";

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
    await summarizeWithByok({ ...ARGS, text: "t", length: "long" });
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

  it("fences the document, so a line planted in it cannot claim the document ended", async () => {
    const f = mockOk("x");
    await summarizeWithByok({ ...ARGS, text: "DOCUMENT BODY HERE", length: "short" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    const id = body.system.match(/<<<DOCUMENT ([0-9a-f]{16})>>>/)?.[1];
    expect(id).toBeTruthy();
    const turn = JSON.stringify(body.messages);
    expect(turn).toContain(`<<<DOCUMENT ${id}>>>`);
    expect(turn).toContain(`<<<END DOCUMENT ${id}>>>`);
    expect(turn).toContain("DOCUMENT BODY HERE");
  });

  it("draws a fresh id per run, so one learned from a reply is spent", async () => {
    const f = mockOk("x");
    await summarizeWithByok({ ...ARGS, text: "t", length: "short" });
    await summarizeWithByok({ ...ARGS, text: "t", length: "short" });
    const idOf = (i: number) =>
      JSON.parse((f.mock.calls[i][1] as RequestInit).body as string)
        .system.match(/<<<DOCUMENT ([0-9a-f]{16})>>>/)?.[1];
    expect(idOf(0)).toBeTruthy();
    expect(idOf(0)).not.toBe(idOf(1));
  });

  it("fences each chunk summary before stitching, under an id the chunks never saw", async () => {
    // A chunk summary is model output derived from untrusted text, so it is
    // untrusted. Left as a bare "Section N:" label it could forge a section.
    const f = mockOk("part");
    const long = "word ".repeat(MAX_CHARS_PER_CALL);
    await summarizeWithByok({ ...ARGS, text: long, length: "medium" });

    const bodyAt = (i: number) => JSON.parse((f.mock.calls[i][1] as RequestInit).body as string);
    const idIn = (sys: string) => sys.match(/<<<DOCUMENT ([0-9a-f]{16})>>>/)?.[1];

    const chunkId = idIn(bodyAt(0).system);
    const stitch = bodyAt(f.mock.calls.length - 1);
    const stitchId = idIn(stitch.system);

    expect(chunkId).toBeTruthy();
    expect(stitchId).toBeTruthy();
    expect(stitchId).not.toBe(chunkId);

    const turn = JSON.stringify(stitch.messages);
    expect(turn).toContain(`<<<DOCUMENT ${stitchId}`);
    expect(turn).toContain(`<<<END DOCUMENT ${stitchId}>>>`);
    expect(turn).not.toContain(chunkId);
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

describe("translateLinesWithByok", () => {
  const LINES = ["When I was young,", "my father took me", "- Are you coming?"];
  const ARGS_LINES = { ...ARGS, targetLanguage: "Spanish", lines: LINES };

  it("sends the lines numbered inside a fresh fence, and returns one translation per line", async () => {
    const f = mockOk("[1] Cuando era joven,\n[2] mi padre me llevó\n[3] - ¿Vienes?");
    const out = await translateLinesWithByok(ARGS_LINES);
    expect(out).toEqual(["Cuando era joven,", "mi padre me llevó", "- ¿Vienes?"]);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    const id = body.system.match(/<<<DOCUMENT ([0-9a-f]{16})>>>/)?.[1];
    expect(id).toBeTruthy();
    expect(body.system).toMatch(/Translate into Spanish\.$/);
    expect(body.system).toMatch(/never merge two lines, split one, skip a number or add one/);
    const turn = body.messages[0].content as string;
    expect(turn).toBe(`<<<DOCUMENT ${id} — 3 subtitle lines>>>\n[1] When I was young,\n[2] my father took me\n[3] - Are you coming?\n<<<END DOCUMENT ${id}>>>`);
  });

  it("draws a fresh fence for every call", async () => {
    const f = mockOk("[1] a\n[2] b\n[3] c");
    await translateLinesWithByok(ARGS_LINES);
    await translateLinesWithByok(ARGS_LINES);
    const idOf = (i: number) => JSON.parse((f.mock.calls[i][1] as RequestInit).body as string).system.match(/<<<DOCUMENT ([0-9a-f]{16})>>>/)?.[1];
    expect(idOf(0)).not.toBe(idOf(1));
  });

  it("refuses a reply whose numbers don't match, rather than shifting lines", async () => {
    mockOk("[1] Cuando era joven, mi padre me llevó\n[2] - ¿Vienes?");
    await expect(translateLinesWithByok(ARGS_LINES)).rejects.toBeInstanceOf(NumberedReplyError);
  });

  it("refuses an answer an OpenAI-shaped provider cut off at its output limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "[1] Cuando era joven,\n[2] mi padre me llevó\n[3] - ¿Vie" }, finish_reason: "length" }] }),
    } as unknown as Response);
    await expect(translateLinesWithByok({ ...ARGS_LINES, providerId: "groq" })).rejects.toMatchObject({ name: "ByokError", kind: "TooLong" });
  });

  it("sends nothing for no lines", async () => {
    const f = mockOk("x");
    await expect(translateLinesWithByok({ ...ARGS_LINES, lines: [] })).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
