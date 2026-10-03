import { describe, expect, it } from "vitest";
import * as knownModels from "gpt-tokenizer/models";
import { DEFAULT_ENCODING, modelToEncodingMap } from "gpt-tokenizer/mapping";
import { GPT_ENCODINGS, countGptTokens, loadGptEncoder, type GptEncodingId } from "./gpt";

/**
 * Reference tokenizations from OpenAI's own tiktoken, as its cookbook "How to
 * count tokens with tiktoken" prints them: token ids for o200k_base and
 * cl100k_base. Matching ids, not only counts, shows the encodings are the real
 * ones.
 */
const REFERENCE: Array<{ text: string; o200k_base: number[]; cl100k_base: number[] }> = [
    { text: "hello world", o200k_base: [24912, 2375], cl100k_base: [15339, 1917] },
    { text: "tiktoken is great!", o200k_base: [83, 8251, 2488, 382, 2212, 0], cl100k_base: [83, 1609, 5963, 374, 2294, 0] },
    { text: "antidisestablishmentarianism", o200k_base: [493, 129901, 376, 160388, 21203, 2367], cl100k_base: [519, 85342, 34500, 479, 8997, 2191] },
    { text: "2 + 2 = 4", o200k_base: [17, 659, 220, 17, 314, 220, 19], cl100k_base: [17, 489, 220, 17, 284, 220, 19] },
    { text: "お誕生日おめでとう", o200k_base: [8930, 9697, 243, 128225, 8930, 17693, 4344, 48669], cl100k_base: [33334, 45918, 243, 21990, 9080, 33334, 62004, 16556, 78699] },
];

const ids: GptEncodingId[] = ["o200k_base", "cl100k_base"];

describe("GPT token counts", () => {
    it.each(REFERENCE)("matches tiktoken for $text", async row => {
        for (const id of ids) {
            const encoder = await loadGptEncoder(id);
            expect([...encoder.encodeGenerator(row.text, { disallowedSpecial: new Set() })].flat(), id).toEqual(row[id]);
            expect(await countGptTokens(row.text, encoder), id).toBe(row[id].length);
        }
    });

    it("counts nothing in an empty text", async () => {
        expect(await countGptTokens("", await loadGptEncoder("o200k_base"))).toBe(0);
    });

    it("counts special-token look-alikes as the ordinary text they are, rather than refusing them", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        // <|endoftext|> written in a prompt is text: < | end of text | > and so on, never token 199999.
        expect(await countGptTokens("<|endoftext|>", encoder)).toBe(7);
        expect(await countGptTokens("a <|im_start|> b", await loadGptEncoder("cl100k_base"))).toBeGreaterThan(3);
    });

    it("counts a long text exactly while giving the page a chance to respond", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const text = Array.from({ length: 60_000 }, (_, i) => `Line ${i}: privacy-first token counter, ünïcödé 数据 ${i % 7 ? "word" : "\n\n"}`).join(" ");
        const seen: number[] = [];
        const count = await countGptTokens(text, encoder, { onProgress: done => seen.push(done), sliceMs: 0 });
        expect(count).toBe(encoder.countTokens(text, { disallowedSpecial: new Set() }));
        expect(seen.length).toBeGreaterThan(1);
        expect(seen[seen.length - 1]).toBe(text.length);
        expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    });

    it("stops when asked", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const controller = new AbortController();
        const text = "word ".repeat(200_000);
        const run = countGptTokens(text, encoder, { signal: controller.signal, sliceMs: 0, onProgress: () => controller.abort() });
        await expect(run).rejects.toMatchObject({ name: "AbortError" });
    });
});

describe("the models named for each encoding", () => {
    const specs = knownModels as Record<string, unknown>;
    it("are models gpt-tokenizer itself knows and maps to that encoding", () => {
        for (const encoding of GPT_ENCODINGS) {
            expect(encoding.models.length).toBe(encoding.modelIds.length);
            for (const id of encoding.modelIds) {
                expect(specs[id], `${id} is in gpt-tokenizer's model list`).toBeDefined();
                // The package's own rule: a listed model, else o200k_base (GptEncoding.getEncodingApiForModel).
                expect((modelToEncodingMap as Record<string, string>)[id] ?? DEFAULT_ENCODING, id).toBe(encoding.id);
            }
        }
    });

    it("covers both encodings the page counts with", () => {
        expect(GPT_ENCODINGS.map(encoding => encoding.id)).toEqual(["o200k_base", "cl100k_base"]);
    });
});
