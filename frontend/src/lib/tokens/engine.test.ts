/**
 * Where the work runs. Stand-in Workers answer with the real jobs, one per
 * encoding as in the browser, so these tests hold the page's side of the
 * workers to its promises: results and errors arrive as the work left them,
 * Cancel ends the workers at once (even ones stuck in a single long step),
 * the next job gets new ones, and where no worker starts, the page does the
 * work itself.
 */
import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { isTransientFailure, toolErrorKind } from "@/lib/toolRun";
import { readDocxText } from "./docx";
import { loadGptEncoder } from "./encoders";
import { ReadError } from "./errors";
import type { GptEncodingId } from "./gpt";
import { answer } from "./jobs";
import { createTokenEngine, type WorkerFactory } from "./engine";
import { TooManyChunksError } from "./split";
import type { TokenReply, TokenRequest } from "./protocol";

type Behaviour = "answer" | "hang" | "fail-to-load" | "fail-to-start";

const docx = (text: string) => zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) });

/** A Worker for one encoding that answers with the real jobs, never answers, or never loads. */
class StandIn {
    onmessage: ((event: MessageEvent<TokenReply>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    readonly requests: TokenRequest[] = [];
    readonly transfers: Transferable[][] = [];

    constructor(readonly encoding: GptEncodingId, private readonly behaviour: Behaviour) {
        if (behaviour === "fail-to-start") throw new SyntaxError("Module scripts are not supported on DedicatedWorker yet.");
        if (behaviour === "fail-to-load") setTimeout(() => this.onerror?.(new Event("error")), 0);
        else this.send({ type: "ready" });
    }

    private send(reply: TokenReply) {
        setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: reply } as MessageEvent<TokenReply>); }, 0);
    }

    postMessage(request: TokenRequest, transfer: Transferable[] = []) {
        this.requests.push(request);
        this.transfers.push(transfer);
        if (this.behaviour !== "answer") return;
        void (async () => {
            const encoders = [{ id: this.encoding, encoder: await loadGptEncoder(this.encoding) }];
            const readDocx = this.encoding === "cl100k_base" ? (bytes: Uint8Array, name: string) => readDocxText(bytes, { name }) : undefined;
            await answer(request, reply => this.send(reply), { encoders, readDocx });
        })();
    }

    terminate() { this.terminated = true; }
}

/** Starts stand-ins: the behaviour for each new worker, by encoding, "answer" when none is given. */
function factory(behaviours: Partial<Record<GptEncodingId, Behaviour[]>> = {}) {
    const started: StandIn[] = [];
    const create: WorkerFactory = encoding => {
        const queue = behaviours[encoding] ?? [];
        const worker = new StandIn(encoding, queue.length ? queue.shift()! : "answer");
        started.push(worker);
        return worker as unknown as Worker;
    };
    const of = (encoding: GptEncodingId) => started.filter(worker => worker.encoding === encoding);
    return { create: vi.fn(create), started, of };
}

describe("in workers, one per encoding", () => {
    it("counts in both at once, splits in the encoding's own, reads Word files in cl100k's, and keeps them for every job", async () => {
        const { create, of } = factory();
        const engine = createTokenEngine(create);
        const progress: Array<[number, string | undefined]> = [];
        expect(await engine.count("hello world", { onProgress: (fraction, detail) => progress.push([fraction, detail]) }))
            .toEqual({ gpt: { o200k_base: 2, cl100k_base: 2 }, characters: 11, words: 2 });
        expect(progress[progress.length - 1]).toEqual([1, "o200k_base and cl100k_base"]);
        expect(of("o200k_base")[0].requests.map(request => request.type)).toEqual(["count"]);
        expect(of("cl100k_base")[0].requests.map(request => request.type)).toEqual(["count"]);

        const chunks = await engine.split("One sentence after another. ".repeat(30), 20, "o200k_base");
        expect(chunks.length).toBeGreaterThan(1);
        expect(of("o200k_base")[0].requests.map(request => request.type)).toEqual(["count", "split"]);

        const bytes = docx("Hi");
        expect(await engine.readDocx(bytes, "hi.docx")).toBe("Hi");
        const reader = of("cl100k_base")[0];
        expect(reader.requests.map(request => request.type)).toEqual(["count", "docx"]);
        // The Word file's bytes move to the worker rather than being copied.
        expect(reader.transfers[1]).toHaveLength(1);
        expect(reader.transfers[1][0]).toBe(bytes.buffer);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it("hands back the workers' errors as the page's own: words, reason and category intact", async () => {
        const engine = createTokenEngine(factory().create);
        const longRun = await engine.count("x".repeat(20_001)).catch(e => e);
        expect(longRun).toBeInstanceOf(ReadError);
        expect(longRun).toMatchObject({ code: "long-run" });
        expect(longRun.message).toMatch(/^This text has 20,001 letters in a row/);
        expect(toolErrorKind(longRun)).toBe("bad_input");
        const tooMany = await engine.split("word ".repeat(120_000), 10, "cl100k_base").catch(e => e);
        expect(tooMany).toBeInstanceOf(TooManyChunksError);
        expect(toolErrorKind(tooMany)).toBe("bad_input");
        const unreadable = await engine.readDocx(strToU8("not a zip"), "report.docx").catch(e => e);
        expect(unreadable).toMatchObject({ name: "ReadError", code: "docx-unreadable" });
    });

    it("ends both workers on Cancel, even mid-step, and starts new ones for the next job", async () => {
        const { create, of } = factory({ o200k_base: ["hang"], cl100k_base: ["hang"] });
        const engine = createTokenEngine(create);
        const controller = new AbortController();
        const stuck = engine.count("a long count", { signal: controller.signal });
        controller.abort();
        await expect(stuck).rejects.toMatchObject({ name: "AbortError" });
        expect(of("o200k_base")[0].terminated && of("cl100k_base")[0].terminated).toBe(true);
        expect(await engine.count("hello world")).toMatchObject({ gpt: { o200k_base: 2, cl100k_base: 2 } });
        expect(create).toHaveBeenCalledTimes(4);
    });

    it("ends the other worker's count when one fails", async () => {
        const { create, of } = factory({ o200k_base: ["hang"], cl100k_base: ["fail-to-load"] });
        const engine = createTokenEngine(create);
        const error = await engine.count("hello world").catch(e => e);
        expect(toolErrorKind(error)).toBe("network");
        expect(of("o200k_base")[0].terminated).toBe(true);
    });

    it("refuses a job already cancelled without sending it", async () => {
        const { create, started } = factory();
        const engine = createTokenEngine(create);
        const controller = new AbortController();
        controller.abort();
        await expect(engine.count("hello", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(started.flatMap(worker => worker.requests)).toEqual([]);
    });

    it("stops when the page goes, failing whatever waited as cancelled", async () => {
        const { create, started } = factory({ o200k_base: ["hang"], cl100k_base: ["hang"] });
        const engine = createTokenEngine(create);
        const waiting = engine.count("text");
        engine.stop();
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        expect(started.every(worker => worker.terminated)).toBe(true);
    });

    it("calls a worker that never loaded a failed download, which is worth retrying", async () => {
        const { create } = factory({ o200k_base: ["fail-to-load"] });
        const engine = createTokenEngine(create);
        const error = await engine.count("hello world").catch(e => e);
        expect(toolErrorKind(error)).toBe("network");
        expect(isTransientFailure(error)).toBe(true);
        // A retry starts new workers.
        expect(await engine.count("hello world")).toMatchObject({ gpt: { o200k_base: 2, cl100k_base: 2 } });
    });

    it("calls a worker that stopped with an error of its own a fault in the browser", async () => {
        const { create, of } = factory({ o200k_base: ["hang"], cl100k_base: ["hang"] });
        const engine = createTokenEngine(create);
        const waiting = engine.count("text");
        await new Promise(resolve => setTimeout(resolve, 5));
        of("o200k_base")[0].onerror?.(Object.assign(new Event("error"), { message: "Uncaught RangeError: Array buffer allocation failed" }));
        const error = await waiting.catch(e => e);
        expect(toolErrorKind(error)).toBe("browser");
        expect(isTransientFailure(error)).toBe(false);
        expect(of("cl100k_base")[0].terminated).toBe(true);
    });
});

describe("on the page", () => {
    it("does the work itself where no worker starts, and from then on", async () => {
        const { create } = factory({ o200k_base: ["fail-to-start"] });
        const engine = createTokenEngine(create);
        expect(await engine.count("hello world")).toEqual({ gpt: { o200k_base: 2, cl100k_base: 2 }, characters: 11, words: 2 });
        expect(await engine.readDocx(docx("Hi"), "hi.docx")).toBe("Hi");
        expect(await engine.split("One sentence after another. ".repeat(30), 20, "cl100k_base")).not.toHaveLength(0);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("stops between slices when cancelled", async () => {
        const engine = createTokenEngine(null);
        const controller = new AbortController();
        const text = "word after word, ".repeat(200_000);
        const run = engine.count(text, { signal: controller.signal, onProgress: () => controller.abort() });
        await expect(run).rejects.toMatchObject({ name: "AbortError" });
    });
});
