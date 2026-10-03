import { describe, expect, it, vi } from "vitest";
import { LOCAL_MODELS } from "./localModels";
import { toolErrorKind } from "./toolRun";
import { WHISPER, WhisperWorker, yieldBetweenSteps } from "./whisper";
import type { WhisperReply } from "./whisper-protocol";

/** A stand-in for the Whisper worker: records what the page sends and lets the test answer. */
function fakeWorker() {
    const sent: { message: { id: number; type: string; audio?: Float32Array }; transfer: Transferable[] }[] = [];
    const fake = {
        scripts: [] as string[],
        onmessage: null as null | ((event: { data: WhisperReply }) => void),
        onerror: null as null | ((event: { message: string; preventDefault?: () => void }) => void),
        onmessageerror: null as null | (() => void),
        postMessage: (message: never, transfer: Transferable[] = []) => { sent.push({ message, transfer }); },
        terminate: vi.fn(),
    };
    const reply = (data: WhisperReply) => fake.onmessage?.({ data });
    return { fake, sent, reply };
}

describe("talking to the Whisper worker", () => {
    it("starts it from a blob: wrapper that loads the worker script, so it runs under the page's policy", () => {
        const { fake } = fakeWorker();
        let wrapper = "";
        new WhisperWorker(url => { wrapper = url; return fake as unknown as Worker; });
        expect(wrapper).toMatch(/^blob:/);
    });

    it("matches each answer to its request and passes on download progress", async () => {
        const { fake, sent, reply } = fakeWorker();
        const worker = new WhisperWorker(() => fake as unknown as Worker);
        const progress: number[] = [];
        const loading = worker.request({ type: "load", hfId: "Xenova/whisper-base", bytes: 1 }, percent => progress.push(percent));
        const audio = new Float32Array(16000).fill(0.5);
        const running = worker.request({ type: "run", hfId: "Xenova/whisper-base", audio, options: { language: "en" } });
        const [load, run] = sent.map(entry => entry.message);
        reply({ type: "progress", id: load.id, percent: 40 });
        reply({ type: "result", id: run.id, output: { text: "hello" } });
        reply({ type: "ready", id: load.id });
        await expect(loading).resolves.toBeUndefined();
        await expect(running).resolves.toEqual({ text: "hello" });
        expect(progress).toEqual([40]);
    });

    it("hands back a failed download as the network's, so the page offers another try", async () => {
        const { fake, sent, reply } = fakeWorker();
        const worker = new WhisperWorker(() => fake as unknown as Worker);
        const loading = worker.request({ type: "load", hfId: "Xenova/whisper-tiny", bytes: 1 });
        reply({ type: "error", id: sent[0].message.id, name: "TypeError", message: "Failed to fetch", network: true });
        const error = await loading.catch(caught => caught);
        expect(error).toMatchObject({ name: "TypeError", message: "Failed to fetch" });
        expect(toolErrorKind(error)).toBe("network");
    });

    it("runs a loaded model in the worker, sending a copy of the audio so the caller's buffer stays whole", async () => {
        const instances: { sent: { message: { id: number; type: string; audio?: Float32Array }; transfer: Transferable[] }[] }[] = [];
        class StandIn {
            sent: { message: { id: number; type: string; audio?: Float32Array }; transfer: Transferable[] }[] = [];
            onmessage: ((event: { data: WhisperReply }) => void) | null = null;
            constructor() { instances.push(this); }
            postMessage(message: { id: number; type: string; audio?: Float32Array }, transfer: Transferable[] = []) {
                this.sent.push({ message, transfer });
                const data: WhisperReply = message.type === "load" ? { type: "ready", id: message.id } : { type: "result", id: message.id, output: { text: "ok" } };
                queueMicrotask(() => this.onmessage?.({ data }));
            }
            terminate() {}
        }
        vi.stubGlobal("Worker", StandIn);
        try {
            const { loadWhisper } = await import("./whisper");
            const progress: number[] = [];
            const asr = await loadWhisper("tiny", percent => progress.push(percent));
            expect(progress).toEqual([100]);
            const long = new Float32Array(32000).fill(1);
            await expect(asr(long.subarray(16000), { language: "en" })).resolves.toEqual({ text: "ok" });
            const run = instances[0].sent.find(entry => entry.message.type === "run")!;
            expect(run.message.audio!.length).toBe(16000);
            expect(run.transfer).toEqual([run.message.audio!.buffer]);
            expect(run.message.audio!.buffer).not.toBe(long.buffer);
            expect(long.length).toBe(32000);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("fails everything waiting when the worker itself stops, and refuses more", async () => {
        const { fake, reply } = fakeWorker();
        const worker = new WhisperWorker(() => fake as unknown as Worker);
        const loading = worker.request({ type: "load", hfId: "Xenova/whisper-tiny", bytes: 1 });
        fake.onerror?.({ message: "Uncaught RangeError: memory" });
        await expect(loading).rejects.toThrow("Uncaught RangeError: memory");
        expect(worker.broken).toBe(true);
        expect(fake.terminate).toHaveBeenCalled();
        await expect(worker.request({ type: "load", hfId: "Xenova/whisper-tiny", bytes: 1 })).rejects.toThrow(/stopped/);
        reply({ type: "ready", id: 1 });
    });
});

describe("the shared Whisper engine", () => {
    it("uses exactly the two Whisper models in the model registry, with their download sizes", () => {
        for (const [size, id] of [["tiny", "whisper-tiny"], ["base", "whisper-base"]] as const) {
            const registered = LOCAL_MODELS.find(model => model.id === id)!;
            expect(WHISPER[size].hfId).toBe(registered.hfId);
            expect(WHISPER[size].size).toBe(registered.approxLabel);
        }
        expect(WHISPER.tiny.hfId).toBe("Xenova/whisper-tiny");
        expect(WHISPER.base.hfId).toBe("Xenova/whisper-base");
        expect(WHISPER.base.bytes).toBe(74 * 1024 * 1024);
    });

    it("gives the page a turn before every model step", async () => {
        const calls: string[] = [];
        const session = {
            name: "decoder",
            async run(this: { name: string }, feed: number) { calls.push(`${this.name} ${feed}`); return feed * 2; },
        };
        const pipeline = { model: { sessions: { decoder_model_merged: session } } };
        yieldBetweenSteps(pipeline);
        const step = session.run(21);
        // Not within the microtasks that follow: only after a task boundary.
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(calls).toEqual([]);
        await expect(step).resolves.toBe(42);
        expect(calls).toEqual(["decoder 21"]);
    });

    it("leaves a pipeline without sessions alone", () => {
        expect(() => yieldBetweenSteps({})).not.toThrow();
        expect(() => yieldBetweenSteps(null)).not.toThrow();
    });
});
