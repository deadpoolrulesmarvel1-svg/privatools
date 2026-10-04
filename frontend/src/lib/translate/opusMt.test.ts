/**
 * Talking to the OPUS-MT worker (lib/translate/opusMt.ts), with the worker
 * stood in for: the messages, the progress, errors, and Cancel, which ends
 * the worker. The worker's own handling is tested in opusMt-core.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The model on the page: these tests check when the page would load it.
const onPage = vi.hoisted(() => ({ imported: vi.fn(), steps: [] as string[] }));
vi.mock("@huggingface/transformers", () => {
    onPage.imported();
    const session = { run: async () => { onPage.steps.push("step"); return {}; } };
    return {
        env: { fetch: async () => ({}) },
        pipeline: vi.fn(async () => Object.assign(async (text: string) => { await session.run(); return [{ translation_text: `es ${text}` }]; }, {
            tokenizer: { encode: (text: string) => [...text.split(/\s+/).filter(Boolean), "</s>"] },
            model: { sessions: { decoder_model_merged: session } },
        })),
    };
});
const cache = vi.hoisted(() => ({ removed: [] as string[] }));
vi.mock("@/lib/localModels", async original => ({
    ...(await original<object>()),
    removeCachedModel: vi.fn(async (hfId: string) => { cache.removed.push(hfId); }),
}));

import { toolErrorKind } from "@/lib/toolRun";
import { loadDeviceTranslator, OpusMtWorker, stopDeviceTranslator, type ModelStage } from "./opusMt";
import type { OpusMtReply, OpusMtRequest } from "./opusMt-protocol";

const MODEL = "Xenova/opus-mt-en-es";

/** A stand-in for the worker: records what the page sends and lets the test answer. */
function fakeWorker() {
    const sent: OpusMtRequest[] = [];
    const fake = {
        onmessage: null as null | ((event: { data: OpusMtReply }) => void),
        onerror: null as null | ((event: { message: string; preventDefault?: () => void }) => void),
        onmessageerror: null as null | (() => void),
        postMessage: (message: OpusMtRequest) => { sent.push(message); },
        terminate: vi.fn(),
    };
    const reply = (data: OpusMtReply) => fake.onmessage?.({ data });
    return { fake, sent, reply };
}

/**
 * Worker stand-ins for the shared connection: each answers a load with what
 * `onLoad` says (ready, at once, by default) and every other request by `answer`.
 */
function standIns(onLoad: (message: OpusMtRequest, post: (reply: OpusMtReply) => void) => void = (message, post) => post({ type: "ready", id: message.id }),
    answer: (message: OpusMtRequest) => OpusMtReply | null = message => ({ type: "result", id: message.id, output: "" })) {
    const instances: { sent: OpusMtRequest[]; terminated: boolean; post: (reply: OpusMtReply) => void }[] = [];
    class StandIn {
        sent: OpusMtRequest[] = [];
        terminated = false;
        onmessage: ((event: { data: OpusMtReply }) => void) | null = null;
        constructor() { instances.push(this); }
        post = (reply: OpusMtReply) => queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: reply }); });
        postMessage(message: OpusMtRequest) {
            this.sent.push(message);
            if (message.type === "load") onLoad(message, this.post);
            else { const data = answer(message); if (data) this.post(data); }
        }
        terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", StandIn);
    return instances;
}

afterEach(() => {
    stopDeviceTranslator();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    onPage.imported.mockClear();
    onPage.steps.length = 0;
    cache.removed.length = 0;
});

describe("talking to the OPUS-MT worker", () => {
    it("starts it from a blob: wrapper that loads the worker script, so it runs under the page's policy", () => {
        const { fake } = fakeWorker();
        let wrapper = "";
        new OpusMtWorker(url => { wrapper = url; return fake as unknown as Worker; });
        expect(wrapper).toMatch(/^blob:/);
    });

    it("releases the wrapper's address once the worker has answered", async () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        try {
            const { fake, sent, reply } = fakeWorker();
            let wrapper = "";
            const worker = new OpusMtWorker(url => { wrapper = url; return fake as unknown as Worker; });
            const loading = worker.request({ type: "load", modelId: MODEL, bytes: 1 });
            expect(revoke).not.toHaveBeenCalledWith(wrapper);
            reply({ type: "ready", id: sent[0].id });
            await loading;
            expect(revoke).toHaveBeenCalledWith(wrapper);
        } finally {
            revoke.mockRestore();
        }
    });

    it("matches each answer to its request, whatever the order", async () => {
        const { fake, sent, reply } = fakeWorker();
        const worker = new OpusMtWorker(() => fake as unknown as Worker);
        const first = worker.request({ type: "translate", modelId: MODEL, text: "One." });
        const second = worker.request({ type: "translate", modelId: MODEL, text: "Two." });
        reply({ type: "result", id: sent[1].id, output: "Dos." });
        reply({ type: "result", id: sent[0].id, output: "Uno." });
        await expect(first).resolves.toBe("Uno.");
        await expect(second).resolves.toBe("Dos.");
    });

    it("hands back a failed download as the network's, so the page offers another try", async () => {
        const { fake, sent, reply } = fakeWorker();
        const worker = new OpusMtWorker(() => fake as unknown as Worker);
        const loading = worker.request({ type: "load", modelId: MODEL, bytes: 1 });
        reply({ type: "error", id: sent[0].id, name: "TypeError", message: "Failed to fetch", network: true });
        const error = await loading.catch(caught => caught);
        expect(error).toMatchObject({ name: "TypeError", message: "Failed to fetch" });
        expect(toolErrorKind(error)).toBe("network");
    });

    it("ends the worker on terminate, failing whatever waits on it as stopped: a cancel, not a failure", async () => {
        const { fake } = fakeWorker();
        const worker = new OpusMtWorker(() => fake as unknown as Worker);
        const running = worker.request({ type: "translate", modelId: MODEL, text: "A long piece." });
        worker.terminate();
        const error = await running.catch((caught: Error) => caught);
        expect((error as Error).name).toBe("AbortError");
        expect(toolErrorKind(error)).toBe("cancelled");
        expect(fake.terminate).toHaveBeenCalledTimes(1);
        worker.terminate();
        expect(fake.terminate).toHaveBeenCalledTimes(1);
    });

    it("fails everything waiting when the worker itself stops, and refuses more", async () => {
        const { fake, reply } = fakeWorker();
        const worker = new OpusMtWorker(() => fake as unknown as Worker);
        const loading = worker.request({ type: "load", modelId: MODEL, bytes: 1 });
        fake.onerror?.({ message: "Uncaught RangeError: memory" });
        await expect(loading).rejects.toThrow("Uncaught RangeError: memory");
        expect(worker.broken).toBe(true);
        expect(fake.terminate).toHaveBeenCalled();
        await expect(worker.request({ type: "load", modelId: MODEL, bytes: 1 })).rejects.toThrow(/stopped/);
        reply({ type: "ready", id: 1 });
    });
});

describe("the shared translator", () => {
    it("loads the model in a worker and never imports transformers.js on the page", async () => {
        const instances = standIns();
        await loadDeviceTranslator(MODEL, () => {});
        expect(instances).toHaveLength(1);
        expect(instances[0].sent.map(message => message.type)).toEqual(["load"]);
        expect(instances[0].sent[0]).toMatchObject({ modelId: MODEL, bytes: 107 * 1024 * 1024 });
        expect(onPage.imported).not.toHaveBeenCalled();
    });

    it("passes on the download, how much has arrived and the model being built, then 100 once it's ready", async () => {
        standIns((message, post) => {
            post({ type: "downloading", id: message.id });
            post({ type: "progress", id: message.id, percent: 40 });
            post({ type: "progress", id: message.id, percent: 99 });
            post({ type: "preparing", id: message.id });
            post({ type: "ready", id: message.id });
        });
        const heard: (number | ModelStage)[] = [];
        await loadDeviceTranslator(MODEL, percent => heard.push(percent), stage => heard.push(stage));
        expect(heard).toEqual(["download", 40, 99, "prepare", 100]);
    });

    it("asks the worker for the pieces, the runs and each translation, for the pair it loaded", async () => {
        const instances = standIns(undefined, message => {
            if (message.type === "chunk") return { type: "result", id: message.id, output: message.texts.map(text => [text]) };
            if (message.type === "runs") return { type: "result", id: message.id, output: [{ items: message.texts.map((_, i) => i), pieces: [message.texts.join(" ")] }] };
            if (message.type === "translate") return { type: "result", id: message.id, output: `es ${message.text}` };
            return null;
        });
        const translator = await loadDeviceTranslator(MODEL, () => {});
        await expect(translator.chunk(["Page one.", "Page two."], 200)).resolves.toEqual([["Page one."], ["Page two."]]);
        await expect(translator.runs(["When I was young,", "my father took me"], 200)).resolves.toEqual([{ items: [0, 1], pieces: ["When I was young, my father took me"] }]);
        await expect(translator.translate("Hello.")).resolves.toBe("es Hello.");
        expect(instances[0].sent.map(({ id: _id, ...message }) => message)).toEqual([
            { type: "load", modelId: MODEL, bytes: 107 * 1024 * 1024 },
            { type: "chunk", modelId: MODEL, texts: ["Page one.", "Page two."], maxTokens: 200 },
            { type: "runs", modelId: MODEL, texts: ["When I was young,", "my father took me"], maxTokens: 200 },
            { type: "translate", modelId: MODEL, text: "Hello.", maxNewTokens: undefined },
        ]);
    });

    it("says a failed download is the network's, and doesn't run the model on the page instead", async () => {
        standIns((message, post) => post({ type: "error", id: message.id, name: "TypeError", message: "Failed to fetch", network: true }));
        const error = await loadDeviceTranslator(MODEL, () => {}).catch(caught => caught);
        expect(toolErrorKind(error)).toBe("network");
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(onPage.imported).not.toHaveBeenCalled();
    });

    it("ends the worker mid-translation at once, and the next run starts a new one", async () => {
        const instances = standIns(undefined, () => null);
        const translator = await loadDeviceTranslator(MODEL, () => {});
        const running = translator.translate("A piece that takes a while.");
        stopDeviceTranslator();
        await expect(running).rejects.toMatchObject({ name: "AbortError" });
        expect(instances[0].terminated).toBe(true);
        await loadDeviceTranslator(MODEL, () => {});
        expect(instances).toHaveLength(2);
        expect(instances[1].terminated).toBe(false);
    });

    it("stops a load with the worker, and never loads the model on the page instead", async () => {
        // A worker that never finishes loading, as while the model downloads.
        const instances = standIns(() => {});
        const loading = loadDeviceTranslator(MODEL, () => {});
        await Promise.resolve();
        stopDeviceTranslator();
        await expect(loading).rejects.toMatchObject({ name: "AbortError" });
        expect(instances[0].terminated).toBe(true);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(onPage.imported).not.toHaveBeenCalled();
    });

    it("clears what a download stopped part-way left in the cache, now and again shortly after", async () => {
        vi.useFakeTimers();
        standIns((message, post) => { post({ type: "downloading", id: message.id }); post({ type: "progress", id: message.id, percent: 30 }); });
        const loading = loadDeviceTranslator(MODEL, () => {}).catch(caught => caught);
        await vi.advanceTimersByTimeAsync(0);
        stopDeviceTranslator();
        expect(await loading).toMatchObject({ name: "AbortError" });
        expect(cache.removed).toEqual([MODEL]);
        // A file the worker had already handed over can land after it stopped.
        await vi.advanceTimersByTimeAsync(2000);
        expect(cache.removed).toEqual([MODEL, MODEL]);
    });

    it("skips the second clearing once the model is loading again, and keeps a model whose files had all arrived", async () => {
        vi.useFakeTimers();
        let download = true;
        standIns((message, post) => {
            if (download) post({ type: "downloading", id: message.id });
            else post({ type: "preparing", id: message.id });
        });
        const first = loadDeviceTranslator(MODEL, () => {}).catch(caught => caught);
        await vi.advanceTimersByTimeAsync(0);
        stopDeviceTranslator();
        await first;
        expect(cache.removed).toEqual([MODEL]);
        // Loading again at once: its own files are arriving, so nothing more is cleared.
        download = false;
        const second = loadDeviceTranslator(MODEL, () => {}).catch(caught => caught);
        await vi.advanceTimersByTimeAsync(2000);
        // Stopped while the model is being built: every file is in the cache, and stays.
        stopDeviceTranslator();
        expect(await second).toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(2000);
        expect(cache.removed).toEqual([MODEL]);
    });

    it("ends the worker when the page is hidden", async () => {
        const instances = standIns();
        await loadDeviceTranslator(MODEL, () => {});
        window.dispatchEvent(new Event("pagehide"));
        expect(instances[0].terminated).toBe(true);
    });

    it("runs the model on the page where no worker can start, with a turn for the page before each step", async () => {
        vi.stubGlobal("Worker", undefined);
        const translator = await loadDeviceTranslator(MODEL, () => {});
        expect(onPage.imported).toHaveBeenCalled();
        const translating = translator.translate("Hello.");
        // Not within the microtasks that follow: the step waits for the next task.
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(onPage.steps).toEqual([]);
        await expect(translating).resolves.toBe("es Hello.");
        expect(onPage.steps).toEqual(["step"]);
        await expect(translator.chunk(["One. Two."], 200)).resolves.toEqual([["One. Two."]]);
    });
});
