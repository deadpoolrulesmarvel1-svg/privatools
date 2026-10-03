import { describe, expect, it } from "vitest";
import { loadGptEncoder, type GptEncoder } from "./gpt";
import { MAX_CHUNKS, MIN_CHUNK_TOKENS, TooManyChunksError, chunkPreview, chunksAsText, splitIntoChunks } from "./split";

const PLAIN = { disallowedSpecial: new Set<string>() };
const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Synthetic prose: numbered sentences in paragraphs of varying length. */
function prose(paragraphs: number): string {
    const out: string[] = [];
    for (let p = 0; p < paragraphs; p++) {
        const sentences = 2 + (p * 7) % 5;
        out.push(Array.from({ length: sentences }, (_, s) => `Paragraph ${p + 1}, sentence ${s + 1} keeps the counter honest about tokens.`).join(" "));
    }
    return out.join("\n\n");
}

function expectExact(chunks: { text: string; tokens: number }[], max: number, encoder: GptEncoder) {
    for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0);
        expect(chunk.tokens).toBeLessThanOrEqual(max);
        // Each count is the chunk's own, as the tokenizer counts it alone.
        expect(encoder.countTokens(chunk.text, PLAIN)).toBe(chunk.tokens);
    }
}

describe("splitting text into chunks of GPT tokens", () => {
    it("keeps every chunk within the limit, counted on its own, and ends chunks between words", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const text = prose(40);
        for (const max of [MIN_CHUNK_TOKENS, 25, 64, 500]) {
            const chunks = await splitIntoChunks(text, max, encoder);
            expectExact(chunks, max, encoder);
            // Every word whole, in order, in exactly one chunk: nothing dropped, nothing cut.
            expect(chunks.flatMap(chunk => words(chunk.text))).toEqual(words(text));
        }
    });

    it("stays exact on mixed text: punctuation, numbers, code, spacing, scripts and long runs", async () => {
        const vocabulary = ["the", "Token", "counter's", "2026", "3.14159", "—", "...", "{", "}", "=>", "foo_bar()", "\t", "  ", "\n", "\n\n", "\r\n",
            "naïve", "数据", "التوكنات", "токены", "🙂", "👩‍💻", "<|endoftext|>", "https://example.com/a?b=c", "x".repeat(90), "ab12cd34".repeat(30)];
        let seed = 20261003;
        const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
        for (const name of ["o200k_base", "cl100k_base"] as const) {
            const encoder = await loadGptEncoder(name);
            for (let round = 0; round < 4; round++) {
                const text = Array.from({ length: 900 }, () => vocabulary[random() % vocabulary.length] + (random() % 3 ? " " : "")).join("");
                for (const max of [MIN_CHUNK_TOKENS, 33, 120]) {
                    const chunks = await splitIntoChunks(text, max, encoder);
                    expectExact(chunks, max, encoder);
                    // No character lost, changed or repeated: only whitespace at chunk edges is dropped.
                    expect(chunks.map(chunk => chunk.text).join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
                }
            }
        }
    });

    it("is exact with cl100k_base too", async () => {
        const encoder = await loadGptEncoder("cl100k_base");
        const chunks = await splitIntoChunks(prose(12), 40, encoder);
        expectExact(chunks, 40, encoder);
    });

    it("ends a chunk at a line end when one falls in its second half", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const line = "Each line here is short and ends cleanly.";
        const text = Array.from({ length: 30 }, () => line).join("\n");
        const perLine = encoder.countTokens(`${line}\n`, PLAIN);
        const chunks = await splitIntoChunks(text, perLine * 4 + 3, encoder);
        expect(chunks.length).toBeGreaterThan(1);
        // Whole lines only: every chunk is some number of complete lines.
        for (const chunk of chunks) expect(chunk.text.split("\n").every(part => part === line)).toBe(true);
    });

    it("never cuts a word in two when the words fit, nor a character ever", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const text = Array.from({ length: 200 }, (_, i) => ["naïve", "café", "数据保护", "🙂🙃", "Ünïcödé", `n${i}`][i % 6]).join(" ");
        const chunks = await splitIntoChunks(text, 12, encoder);
        expectExact(chunks, 12, encoder);
        expect(chunks.flatMap(chunk => words(chunk.text))).toEqual(words(text));
        expect(chunks.some(chunk => chunk.text.includes("�"))).toBe(false);
    });

    it("splits a run longer than a chunk at character boundaries, each part within the limit", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        for (const run of ["Zq8vXw2Lk9".repeat(400), "🙂".repeat(300), "数据".repeat(500)]) {
            const chunks = await splitIntoChunks(run, 20, encoder);
            expectExact(chunks, 20, encoder);
            expect(chunks.map(chunk => chunk.text).join("")).toBe(run);
            expect(chunks.length).toBeGreaterThan(1);
        }
    });

    it("leaves out stretches of nothing but whitespace", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const chunks = await splitIntoChunks(`first part here\n${" ".repeat(400)}\n${"\n".repeat(300)}last part here`, MIN_CHUNK_TOKENS, encoder);
        expect(chunks.map(chunk => chunk.text)).not.toContain("");
        expect(words(chunks.map(chunk => chunk.text).join(" "))).toEqual(["first", "part", "here", "last", "part", "here"]);
    });

    it("refuses a chunk size it cannot honour, and more chunks than a page can list", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        await expect(splitIntoChunks("some text", MIN_CHUNK_TOKENS - 1, encoder)).rejects.toBeInstanceOf(RangeError);
        await expect(splitIntoChunks("some text", 1.5 as number, encoder)).rejects.toBeInstanceOf(RangeError);
        const long = "word ".repeat((MAX_CHUNKS + 5) * MIN_CHUNK_TOKENS);
        await expect(splitIntoChunks(long, MIN_CHUNK_TOKENS, encoder)).rejects.toBeInstanceOf(TooManyChunksError);
    });

    it("stops when asked", async () => {
        const encoder = await loadGptEncoder("o200k_base");
        const controller = new AbortController();
        controller.abort();
        await expect(splitIntoChunks(prose(5), 50, encoder, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
});

describe("what the page shows and saves", () => {
    it("shows a chunk by its first words", () => {
        expect(chunkPreview("  Hello   world,\nthis is\ta short one.  ")).toBe("Hello world, this is a short one.");
        const long = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.";
        const preview = chunkPreview(long);
        expect(preview.endsWith("…")).toBe(true);
        expect(long.startsWith(preview.slice(0, -1).trimEnd())).toBe(true);
        expect(preview.length).toBeLessThanOrEqual(81);
    });

    it("saves every chunk in one text file, each under a line naming it", () => {
        const file = chunksAsText([{ text: "Alpha beta.", tokens: 3 }, { text: "Gamma\ndelta.", tokens: 1234 }], { encoding: "o200k_base", maxTokens: 2000 });
        expect(file).toBe([
            "Split into 2 chunks of at most 2,000 tokens each, counted with o200k_base.",
            "",
            "===== Chunk 1 of 2 · 3 tokens =====",
            "Alpha beta.",
            "",
            "===== Chunk 2 of 2 · 1,234 tokens =====",
            "Gamma\ndelta.",
            "",
        ].join("\n"));
        expect(chunksAsText([{ text: "Solo.", tokens: 1 }], { encoding: "cl100k_base", maxTokens: 10 })).toContain("===== Chunk 1 of 1 · 1 token =====");
    });
});
