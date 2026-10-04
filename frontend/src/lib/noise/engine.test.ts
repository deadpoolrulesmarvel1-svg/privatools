import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { mediaFile } from "@/test/media/fixtures";
import { addNoise, power, rnnoiseModule, speech16k, whiteNoise } from "@/test/noise";
import { toolErrorKind } from "@/lib/toolRun";
import { loadRnnoiseModule, removeNoise, type NoiseRunOptions } from "./engine";
import type { NoiseReply, NoiseRequest } from "./protocol";
import { decodeWav, toPcm16, wavHeader } from "./wav";
import { createNoiseWorkerCore } from "./worker-core";

/** The worker, run in place: the same core, replies delivered a turn later as a worker's would be. */
class FakeWorker {
    onmessage: ((event: MessageEvent<NoiseReply>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    /** Pieces handed over and not yet cleaned, and the most there ever were. */
    waiting = 0;
    mostWaiting = 0;
    private queue = Promise.resolve();
    private readonly core = createNoiseWorkerCore(reply => this.reply(reply));

    constructor(private readonly fail?: (message: NoiseRequest) => void) {
        setTimeout(() => this.reply({ type: "loaded" }));
    }

    private reply(reply: NoiseReply) {
        if (reply.type === "taken") this.waiting--;
        setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: reply } as MessageEvent<NoiseReply>); });
    }

    postMessage(message: NoiseRequest) {
        if (this.terminated) return;
        if (message.type === "pcm" || message.type === "wav" || message.type === "gap") {
            this.waiting++;
            this.mostWaiting = Math.max(this.mostWaiting, this.waiting);
        }
        this.queue = this.queue
            .then(async () => { this.fail?.(message); await this.core.handle(message); })
            .catch((error: Error) => this.reply({ type: "error", name: error.name, message: error.message }));
    }

    terminate() { this.terminated = true; }
}

let workers: FakeWorker[] = [];
const createWorker = (fail?: (message: NoiseRequest) => void) => () => {
    const worker = new FakeWorker(fail);
    workers.push(worker);
    return worker as unknown as Worker;
};
const options = (extra: Partial<NoiseRunOptions> = {}): NoiseRunOptions => ({ strength: 1, createWorker: createWorker(), loadModule: rnnoiseModule, ...extra });

/** A 16 kHz mono WAV file of `samples`. */
function wav(samples: Float32Array, name = "talk.wav", rate = 16000): File {
    const { pcm } = toPcm16([samples]);
    return new NodeFile([wavHeader(1, rate, samples.length), new Uint8Array(pcm.buffer)], name, { type: "audio/wav" }) as unknown as File;
}

/** Half a second of quiet, the speech, half a second of quiet. */
let quietSpeech: Float32Array;

beforeAll(() => {
    const speech = speech16k();
    quietSpeech = new Float32Array(speech.length + 16000);
    quietSpeech.set(speech, 8000);
});

afterEach(() => {
    workers = [];
    vi.restoreAllMocks();
});

describe("cleaning a recording, page and worker together", () => {
    it("cleans a WAV recording into a 48 kHz WAV, the noise in the pauses far quieter", async () => {
        const noisy = addNoise(quietSpeech, whiteNoise(quietSpeech.length, 31), 5);
        const stages: string[] = [];
        const progress: number[] = [];
        const result = await removeNoise(wav(noisy), options({ onStage: stage => stages.push(stage), onProgress: seconds => progress.push(seconds) }));
        expect(stages).toEqual(["reading", "starting", "cleaning"]);
        expect(result.container).toBe("WAV");
        expect(result.gaps).toEqual([]);
        expect(result.stats).toMatchObject({ channels: 1, sourceChannels: 1, rate: 16000, frames: noisy.length * 3 });
        expect(result.seconds).toBeCloseTo(noisy.length / 16000, 6);
        expect(progress[progress.length - 1]).toBeCloseTo(noisy.length / 16000, 6);
        const out = decodeWav(await result.wav.arrayBuffer());
        expect(out.sampleRate).toBe(48000);
        expect(out.channels[0].length).toBe(noisy.length * 3);
        // The first and last 0.4 s are noise alone.
        const before = power(noisy, 0, 6400) + power(noisy, noisy.length - 6400);
        const after = power(out.channels[0], 0, 19200) + power(out.channels[0], out.channels[0].length - 19200);
        expect(10 * Math.log10(after / before)).toBeLessThan(-20);
        expect(workers[0].terminated).toBe(true);
    });

    it("hands the worker at most two pieces at a time", async () => {
        const result = await removeNoise(wav(quietSpeech), options({ pieceSeconds: 0.5 }));
        expect(result.stats.frames).toBe(quietSpeech.length * 3);
        expect(workers[0].mostWaiting).toBeLessThanOrEqual(2);
        expect(workers[0].mostWaiting).toBeGreaterThan(0);
    });

    it("joins pieces the browser decoded, putting silence where it couldn't", async () => {
        let call = 0;
        const decode = async (_bytes: ArrayBuffer, rate: number) => {
            if (++call === 2) throw new Error("EncodingError");
            return { channels: [Float32Array.from({ length: rate * 0.6 }, (_, i) => 0.2 * Math.sin(i / 7))], rate };
        };
        const result = await removeNoise(mediaFile("tone.mp3", "audio/mpeg"), options({ decode, pieceSeconds: 0.5 }));
        expect(result.container).toBe("MP3");
        expect(result.gaps).toHaveLength(1);
        expect(result.gaps[0].end).toBeGreaterThan(result.gaps[0].start);
        expect(result.stats.rate).toBe(44100);
    });

    it("stops at once on cancel: the worker ends and the run fails as cancelled", async () => {
        const controller = new AbortController();
        const run = removeNoise(wav(quietSpeech), options({ pieceSeconds: 0.25, signal: controller.signal, onProgress: seconds => { if (seconds > 0.4) controller.abort(); } }));
        const error = await run.catch(e => e);
        expect(toolErrorKind(error)).toBe("cancelled");
        expect(workers[0].terminated).toBe(true);
    });

    it("passes on a failure inside the worker, and ends it", async () => {
        const error = await removeNoise(wav(quietSpeech), options({ createWorker: createWorker(message => { if (message.type === "wav") throw new RangeError("Array buffer allocation failed"); }) })).catch(e => e);
        expect(error).toMatchObject({ name: "NoiseEngineError", reason: "stopped", message: "Array buffer allocation failed", cause: "memory" });
        expect(workers[0].terminated).toBe(true);
    });

    it("reads a worker that dies before loading as a failed download", async () => {
        const dying = () => {
            const worker = { onmessage: null, onmessageerror: null, terminate: vi.fn(), postMessage: vi.fn(), onerror: null as ((event: Event) => void) | null };
            setTimeout(() => worker.onerror?.(new Event("error")));
            return worker as unknown as Worker;
        };
        const error = await removeNoise(wav(quietSpeech), options({ createWorker: dying })).catch(e => e);
        expect(toolErrorKind(error)).toBe("network");
    });

    it("says what was wrong with the file before loading anything", async () => {
        const loadModule = vi.fn(rnnoiseModule);
        const empty = new NodeFile([], "empty.wav") as unknown as File;
        await expect(removeNoise(empty, options({ loadModule }))).rejects.toMatchObject({ name: "NoiseInputError", problem: "empty" });
        expect(loadModule).not.toHaveBeenCalled();
    });
});

describe("loading RNNoise", () => {
    it("tags a download that never completed as the network's", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
        const error = await loadRnnoiseModule("/assets/rnnoise-missing.wasm").catch(e => e);
        expect(toolErrorKind(error)).toBe("network");
    });

    it("tags a missing file as the server's", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not found", { status: 404 }));
        const error = await loadRnnoiseModule("/assets/rnnoise-gone.wasm").catch(e => e);
        expect(toolErrorKind(error)).toBe("server");
        expect(error.message).toContain("HTTP 404");
    });

    it("says the browser refused when the module won't compile", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9])));
        const error = await loadRnnoiseModule("/assets/rnnoise-bad.wasm").catch(e => e);
        expect(error).toMatchObject({ name: "NoiseEngineError", reason: "wasm" });
        expect(toolErrorKind(error)).toBe("browser");
    });

    it("tries a failed load afresh next time", async () => {
        const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
        await loadRnnoiseModule("/assets/rnnoise-retry.wasm").catch(() => undefined);
        fetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
        await loadRnnoiseModule("/assets/rnnoise-retry.wasm").catch(() => undefined);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
