/**
 * The token counter's work as a worker runs it, and as it answers by
 * message. engine.test.ts drives the same work through the page's side.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { toolErrorKind } from "@/lib/toolRun";
import { readDocxText } from "./docx";
import { loadGptEncoder } from "./encoders";
import type { NamedEncoder } from "./gpt";
import { answer, countText, splitText, textStats, type WorkerKit } from "./jobs";
import { failureError, type TokenReply } from "./protocol";

const PLAIN = { disallowedSpecial: new Set<string>() };
const named = async (id: NamedEncoder["id"]): Promise<NamedEncoder> => ({ id, encoder: await loadGptEncoder(id) });

/** What the paste box showed before: code points, and \S+ runs. */
function reference(text: string) {
    let characters = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0xdc00 || code > 0xdfff) characters++;
    }
    return { characters, words: (text.match(/\S+/g) ?? []).length };
}

describe("characters and words", () => {
    it("counts as before, in one pass: every kind of space, surrogate pairs and lone halves", () => {
        const parts = ["a", "word", " ", "\t", "\n", "\r\n", " ", " ", " ", " ", " ", " ", "　", "﻿", "​", "🙂", "数据", "\ud800", "\udc00", "\u0085", "᠎"];
        let seed = 5;
        const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 8; };
        for (let round = 0; round < 2000; round++) {
            const text = Array.from({ length: random() % 40 }, () => parts[random() % parts.length]).join("");
            expect(textStats(text), JSON.stringify(text)).toEqual(reference(text));
        }
        expect(textStats("")).toEqual({ characters: 0, words: 0 });
    });
});

describe("counting and splitting", () => {
    it("counts exactly with each encoder given, with the text's characters and words", async () => {
        const text = "Count me: 数据 🙂 <|endoftext|>\n\tthen stop.";
        const encoders = [await named("o200k_base"), await named("cl100k_base")];
        const progress: Array<[number, string | undefined]> = [];
        const counted = await countText(text, encoders, { onProgress: (fraction, detail) => progress.push([fraction, detail]) });
        expect(counted).toEqual({
            gpt: { o200k_base: encoders[0].encoder.countTokens(text, PLAIN), cl100k_base: encoders[1].encoder.countTokens(text, PLAIN) },
            ...reference(text),
        });
        expect(progress).toEqual([[0.5, "o200k_base"], [1, "cl100k_base"]]);
        // A worker has one encoder, and counts with it alone.
        expect(await countText(text, [encoders[1]])).toEqual({ gpt: { cl100k_base: counted.gpt.cl100k_base }, ...reference(text) });
    });

    it("refuses a run the tokenizer would take minutes over, before counting or splitting", async () => {
        const run = "A".repeat(25_000);
        const o200k = await named("o200k_base");
        await expect(countText(run, [o200k])).rejects.toMatchObject({ name: "ReadError", code: "long-run" });
        await expect(splitText(run, 100, o200k)).rejects.toMatchObject({ name: "ReadError", code: "long-run" });
    });

    it("splits with the encoder given", async () => {
        const text = "One sentence after another keeps going here. ".repeat(40);
        const cl100k = await named("cl100k_base");
        const chunks = await splitText(text, 30, cl100k);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) expect(cl100k.encoder.countTokens(chunk.text, PLAIN)).toBe(chunk.tokens);
    });
});

describe("answering the page by message", () => {
    const docx = (body: string) => zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`) });
    const kit = async (): Promise<WorkerKit> => ({ encoders: [await named("cl100k_base")], readDocx: (bytes, name) => readDocxText(bytes, { name }) });
    const replies = async (request: Parameters<typeof answer>[0], withKit?: WorkerKit) => {
        const out: TokenReply[] = [];
        await answer(request, reply => out.push(reply), withKit ?? await kit());
        return out;
    };

    it("sends progress, then the result", async () => {
        const out = await replies({ type: "count", id: 7, text: "hello world" });
        expect(out.filter(reply => reply.type === "progress").length).toBeGreaterThan(0);
        expect(out[out.length - 1]).toEqual({ type: "result", id: 7, value: { gpt: { cl100k_base: 2 }, characters: 11, words: 2 } });
    });

    it("reads a Word file where it has a reader, and says so where it hasn't", async () => {
        expect(await replies({ type: "docx", id: 1, bytes: docx("<w:p><w:r><w:t>Hello Word</w:t></w:r></w:p>"), name: "letter.docx" })).toEqual([{ type: "result", id: 1, value: "Hello Word" }]);
        const without = await replies({ type: "docx", id: 2, bytes: docx("<w:p/>"), name: "letter.docx" }, { encoders: [await named("o200k_base")] });
        expect(without).toMatchObject([{ type: "error", id: 2, error: { message: "This worker doesn’t read Word files." } }]);
    });

    it("splits only with its own encoding", async () => {
        const [reply] = (await replies({ type: "split", id: 5, text: "some text", maxTokens: 100, encoding: "o200k_base" })).slice(-1);
        expect(reply).toMatchObject({ type: "error", id: 5, error: { message: "This worker doesn’t count with o200k_base." } });
    });

    it("sends what went wrong as plain data: its words, its reason and its category", async () => {
        const [unreadable] = await replies({ type: "docx", id: 2, bytes: strToU8("not a zip"), name: "report.docx" });
        expect(unreadable).toEqual({
            type: "error", id: 2,
            error: { name: "ReadError", code: "docx-unreadable", kind: "bad_input", message: "report.docx couldn’t be read as a Word document. It may be damaged, or an older .doc file renamed: save it as .docx and try again." },
        });
        const tooMany = (await replies({ type: "split", id: 3, text: "word ".repeat(120_000), maxTokens: 10, encoding: "cl100k_base" })).pop();
        expect(tooMany).toMatchObject({ type: "error", id: 3, error: { name: "TooManyChunksError", kind: "bad_input" } });
        const broken = (await replies({ type: "split", id: 4, text: "some text", maxTokens: 3, encoding: "cl100k_base" })).pop();
        expect(broken).toMatchObject({ type: "error", id: 4, error: { name: "RangeError" } });
        // Made again on the page, an error with no category is the browser's.
        expect(toolErrorKind(failureError((broken as Extract<TokenReply, { type: "error" }>).error))).toBe("browser");
    });
});
