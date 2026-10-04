/**
 * What the OPUS-MT worker does with each message (opusMt-core.ts), run in
 * place with transformers.js stubbed: a model whose files come from this
 * browser's cache or from Hugging Face, a tokenizer of a token a word and
 * the end mark, and a "translation" that upper-cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const FILES = ["config.json", "tokenizer.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

const hub = vi.hoisted(() => ({
    /** The files this browser's cache holds. */
    cached: new Set<string>(),
    /** Optional files the repository lacks: asked for on every load, answered 404, never done (transformers.js 4.3). */
    missing: new Set<string>(),
    /** The download fails after this many files, once. */
    failAfter: -1,
    loads: 0,
    calls: [] as { text: string; options?: Record<string, unknown> }[],
    sessions: [] as unknown[],
}));

vi.mock("@huggingface/transformers", () => {
    // Hugging Face answers 404 for a file the repository lacks.
    const env: { fetch: (input: string | URL, init?: unknown) => Promise<{ status: number }> } = {
        fetch: async input => ({ status: [...hub.missing].some(file => String(input).endsWith(`/${file}`)) ? 404 : 200 }),
    };
    const pipeline = vi.fn(async (_task: string, modelId: string, { progress_callback: progress }: { progress_callback: (event: object) => void }) => {
        hub.loads++;
        for (const file of [...FILES, ...hub.missing]) progress({ status: "initiate", name: modelId, file });
        for (const file of hub.missing) await env.fetch(`https://huggingface.co/${modelId}/resolve/main/${file}`);
        let fetched = 0;
        for (const file of FILES) {
            // transformers.js asks the network only for what the cache doesn't have.
            if (!hub.cached.has(file)) {
                if (fetched++ === hub.failAfter) { hub.failAfter = -1; throw new TypeError("Failed to fetch"); }
                await env.fetch(`https://huggingface.co/${modelId}/resolve/main/${file}`);
            }
            progress({ status: "progress", name: modelId, file, loaded: 100, total: 100 });
            progress({ status: "done", name: modelId, file });
        }
        progress({ status: "ready", task: "translation", model: modelId });
        const translator = Object.assign(async (text: string, options?: Record<string, unknown>) => {
            hub.calls.push({ text, options });
            return [{ translation_text: ` ${text.toUpperCase()} ` }];
        }, {
            // A token a word, and the end mark.
            tokenizer: { encode: (text: string) => [...text.split(/\s+/).filter(Boolean).map((_, i) => i + 5), 0] },
            model: { sessions: {} },
        });
        hub.sessions.push(translator);
        return translator;
    });
    return { env, pipeline };
});

import { chunkByTokens, tokenRuns } from "./chunk";
import { outputBudget } from "./limits";
import { createOpusMtCore } from "./opusMt-core";
import type { OpusMtReply } from "./opusMt-protocol";

const MODEL = "Xenova/opus-mt-en-es";
const count = (text: string) => text.split(/\s+/).filter(Boolean).length + 1;
const last = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];

function core(options?: Parameters<typeof createOpusMtCore>[1]) {
    const replies: OpusMtReply[] = [];
    const handler = createOpusMtCore(reply => replies.push(reply), options);
    return { handler, replies, of: (id: number) => replies.filter(reply => reply.id === id) };
}

beforeEach(() => {
    hub.cached = new Set();
    hub.missing = new Set();
    hub.failAfter = -1;
    hub.loads = 0;
    hub.calls.length = 0;
    hub.sessions.length = 0;
});

describe("loading a pair's model in the worker", () => {
    it("says when a file downloads, how much has arrived, and when every file is here and the model is being built", async () => {
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        const types = of(1).map(reply => reply.type);
        expect(types.filter(type => type === "downloading")).toHaveLength(1);
        expect(types.filter(type => type === "preparing")).toHaveLength(1);
        expect(types.indexOf("downloading")).toBeLessThan(types.indexOf("preparing"));
        expect(last(types)).toBe("ready");
        // Percent of the files' bytes, rising, and 100 only once the model is built.
        const percents = of(1).flatMap(reply => (reply.type === "progress" ? [reply.percent] : []));
        expect(percents).toEqual([...percents].sort((a, b) => a - b));
        const beforeBuilt = of(1).slice(0, types.indexOf("preparing")).flatMap(reply => (reply.type === "progress" ? [reply.percent] : []));
        expect(Math.max(...beforeBuilt)).toBe(99);
        expect(last(percents)).toBe(100);
    });

    it("says nothing of a download when every file comes from this browser's cache", async () => {
        hub.cached = new Set(FILES);
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        const types = of(1).map(reply => reply.type);
        expect(types).not.toContain("downloading");
        expect(types.filter(type => type === "preparing")).toHaveLength(1);
        expect(last(types)).toBe("ready");
    });

    it("doesn't take an optional file the repository lacks for a download, nor wait for it before the model is built", async () => {
        // The page clears a pair whose load was stopped while it downloaded: a cached pair must never look like one.
        hub.cached = new Set(FILES);
        hub.missing = new Set(["generation_config.json"]);
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        const types = of(1).map(reply => reply.type);
        expect(types).not.toContain("downloading");
        expect(types.filter(type => type === "preparing")).toHaveLength(1);
        hub.cached = new Set();
        const first = core();
        await first.handler.handle({ type: "load", id: 2, modelId: MODEL, bytes: 400 });
        const firstTypes = first.of(2).map(reply => reply.type);
        expect(firstTypes.filter(type => type === "downloading")).toHaveLength(1);
        expect(firstTypes.filter(type => type === "preparing")).toHaveLength(1);
    });

    it("hands back a failed download as plain data, the network's, and downloads again next time", async () => {
        hub.failAfter = 1;
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        expect(last(of(1))).toEqual({ type: "error", id: 1, name: "TypeError", message: "Failed to fetch", network: true });
        expect(of(1).map(reply => reply.type)).not.toContain("preparing");
        await handler.handle({ type: "load", id: 2, modelId: MODEL, bytes: 400 });
        expect(last(of(2))).toEqual({ type: "ready", id: 2 });
        expect(hub.loads).toBe(2);
    });

    it("keeps a loaded model, so loading it again is at once", async () => {
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        await handler.handle({ type: "load", id: 2, modelId: MODEL, bytes: 400 });
        expect(of(2)).toEqual([{ type: "ready", id: 2 }]);
        expect(hub.loads).toBe(1);
    });

    it("gives each model it loads to `prepare`, as the page does to take a turn between steps", async () => {
        const prepare = vi.fn();
        const { handler } = core({ prepare });
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        expect(prepare).toHaveBeenCalledWith(hub.sessions[0]);
    });
});

describe("cutting and translating text in the worker", () => {
    it("counts the model's own tokens and lets each translation run past transformers.js's 256-token default", async () => {
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        await handler.handle({ type: "translate", id: 2, modelId: MODEL, text: "one two three" });
        expect(of(2)).toEqual([{ type: "result", id: 2, output: "ONE TWO THREE" }]);
        expect(hub.calls[0].options).toEqual({ max_new_tokens: outputBudget(4) });
        await handler.handle({ type: "translate", id: 3, modelId: MODEL, text: Array.from({ length: 199 }, () => "word").join(" ") });
        expect(hub.calls[1].options).toEqual({ max_new_tokens: 512 });
        await handler.handle({ type: "translate", id: 4, modelId: MODEL, text: "one", maxNewTokens: 7 });
        expect(hub.calls[2].options).toEqual({ max_new_tokens: 7 });
    });

    it("cuts text exactly as chunk.ts does, with the model's own tokenizer", async () => {
        const { handler, of } = core();
        await handler.handle({ type: "load", id: 1, modelId: MODEL, bytes: 400 });
        const page = Array.from({ length: 40 }, (_, i) => `Sentence ${i} has a few words.`).join(" ");
        const texts = [page, "Short.", ""];
        await handler.handle({ type: "chunk", id: 2, modelId: MODEL, texts, maxTokens: 30 });
        expect(of(2)).toEqual([{ type: "result", id: 2, output: texts.map(text => chunkByTokens(text, count, 30)) }]);
        expect((of(2)[0] as { output: string[][] }).output[0].length).toBeGreaterThan(5);
        const passage = ["When I was young,", "my father took me", "to see the sea.", page];
        await handler.handle({ type: "runs", id: 3, modelId: MODEL, texts: passage, maxTokens: 30 });
        expect(of(3)).toEqual([{ type: "result", id: 3, output: tokenRuns(passage, count, 30) }]);
    });

    it("answers a request for a model it hasn't loaded with an error, never silence", async () => {
        const { handler, of } = core();
        await handler.handle({ type: "translate", id: 1, modelId: MODEL, text: "Hello." });
        expect(of(1)).toEqual([expect.objectContaining({ type: "error", id: 1, message: "The translation model isn’t loaded.", network: false })]);
    });
});
