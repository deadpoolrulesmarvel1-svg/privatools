import { describe, expect, it, vi } from "vitest";
import { LOCAL_MODELS } from "./localModels";
import { toolErrorKind } from "./toolRun";
import { stopWhisper, WHISPER, WhisperWorker, yieldBetweenSteps } from "./whisper";
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

    it("releases the wrapper's address once the worker has answered", async () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        try {
            const { fake, sent, reply } = fakeWorker();
            let wrapper = "";
            const worker = new WhisperWorker(url => { wrapper = url; return fake as unknown as Worker; });
            const loading = worker.request({ type: "load", hfId: "Xenova/whisper-tiny", bytes: 1 });
            expect(revoke).not.toHaveBeenCalledWith(wrapper);
            reply({ type: "ready", id: sent[0].message.id });
            await loading;
            expect(revoke).toHaveBeenCalledWith(wrapper);
        } finally {
            revoke.mockRestore();
        }
    });

    it("ends the worker on terminate, failing whatever waits on it as stopped", async () => {
        const { fake } = fakeWorker();
        const worker = new WhisperWorker(() => fake as unknown as Worker);
        const running = worker.request({ type: "run", hfId: "Xenova/whisper-tiny", audio: new Float32Array(16), options: {} });
        worker.terminate();
        const error = await running.catch((caught: Error) => caught);
        expect((error as Error).name).toBe("AbortError");
        expect(toolErrorKind(error)).toBe("cancelled");
        expect(fake.terminate).toHaveBeenCalledTimes(1);
        worker.terminate();
        expect(fake.terminate).toHaveBeenCalledTimes(1);
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

describe("stopping Whisper", () => {
    /** A Worker stand-in that loads at once and never finishes a run, as a long window would not. */
    function standIns() {
        const instances: { terminated: boolean; sent: { type: string }[] }[] = [];
        class StandIn {
            terminated = false;
            sent: { type: string }[] = [];
            onmessage: ((event: { data: WhisperReply }) => void) | null = null;
            constructor() { instances.push(this); }
            postMessage(message: { id: number; type: string }) {
                this.sent.push(message);
                if (message.type === "load") queueMicrotask(() => this.onmessage?.({ data: { type: "ready", id: message.id } }));
            }
            terminate() { this.terminated = true; }
        }
        vi.stubGlobal("Worker", StandIn);
        return instances;
    }

    it("ends the worker mid-run, and the next run starts a new one", async () => {
        stopWhisper();
        const instances = standIns();
        try {
            const { loadWhisper } = await import("./whisper");
            const asr = await loadWhisper("tiny", () => {});
            const running = asr(new Float32Array(16000), { language: "en" });
            stopWhisper();
            await expect(running).rejects.toMatchObject({ name: "AbortError" });
            expect(instances[0].terminated).toBe(true);
            await loadWhisper("tiny", () => {});
            expect(instances).toHaveLength(2);
            expect(instances[1].terminated).toBe(false);
        } finally {
            stopWhisper();
            vi.unstubAllGlobals();
        }
    });

    it("ends the worker when the page is hidden", async () => {
        stopWhisper();
        const instances = standIns();
        try {
            const { loadWhisper } = await import("./whisper");
            await loadWhisper("base", () => {});
            window.dispatchEvent(new Event("pagehide"));
            expect(instances[0].terminated).toBe(true);
        } finally {
            stopWhisper();
            vi.unstubAllGlobals();
        }
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
