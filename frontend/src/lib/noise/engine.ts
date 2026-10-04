/**
 * Voice Noise Remover's run, from the page.
 *
 * The page reads the file's sound and has the browser decode it a piece at a
 * time (source.ts); the worker does the rest (noise.worker.ts). The page
 * keeps at most two pieces with the worker, so memory stays near a few
 * minutes of sound however long the recording. RNNoise's WebAssembly is
 * fetched from this site, once a run starts, and compiled here, where the
 * page's own policy allows WebAssembly; the worker gets the compiled module.
 * Cancel ends the worker and the reading at once.
 */
import rnnoiseWasmUrl from "virtual:rnnoise-wasm";
import { withErrorKind } from "@/lib/api";
import { NoiseEngineError, outOfMemory } from "./errors";
import type { NoiseReply, NoiseRequest, NoiseStats } from "./protocol";
import { RNNOISE_RATE } from "./rnnoise";
import { NoiseInputError, openNoiseSource, type Decode, type SourceItem } from "./source";

export { NoiseEngineError } from "./errors";

/** Pieces handed to the worker and not yet cleaned: one being cleaned, one waiting. */
const IN_FLIGHT = 2;

function abortError(): Error {
    const error = new Error("The noise remover was stopped.");
    error.name = "AbortError";
    return error;
}

let compiled: Promise<WebAssembly.Module> | null = null;

/** RNNoise's module, fetched from this site and compiled once per page; a failed load is tried afresh next time. */
export function loadRnnoiseModule(url: string = rnnoiseWasmUrl): Promise<WebAssembly.Module> {
    compiled ??= (async () => {
        let response: Response;
        try {
            response = await fetch(url);
        } catch {
            throw withErrorKind(new Error("The noise remover couldn’t be downloaded."), "network");
        }
        if (!response.ok) throw withErrorKind(new Error(`The noise remover couldn’t be downloaded (HTTP ${response.status}).`), "server");
        let bytes: ArrayBuffer;
        try {
            bytes = await response.arrayBuffer();
        } catch {
            throw withErrorKind(new Error("The noise remover’s download was cut off."), "network");
        }
        try {
            return await WebAssembly.compile(bytes);
        } catch (error) {
            // A page policy without WebAssembly, a browser setting or an extension that blocks it.
            throw new NoiseEngineError(`This browser didn’t let the noise remover’s WebAssembly run (${(error as Error)?.message || error}).`, "wasm");
        }
    })();
    compiled.catch(() => { compiled = null; });
    return compiled;
}

export type WorkerFactory = () => Worker;

/** Vite builds the worker, with what it imports, into a script of its own. */
const startWorker: WorkerFactory = () => new Worker(new URL("./noise.worker.ts", import.meta.url), { type: "module", name: "noise-remover" });

/** The worker, one run's worth: requests in order, replies by kind. */
class NoiseWorker {
    private readonly worker: Worker;
    private loaded = false;
    private stopped = false;
    private inFlight = 0;
    private waitingForRoom: (() => void) | null = null;
    private waitingFor: { type: "ready" | "done"; resolve: (reply: NoiseReply) => void } | null = null;
    private failure: Error | null = null;
    private failed: ((error: Error) => void)[] = [];

    constructor(create: WorkerFactory, private readonly onProgress: (seconds: number) => void) {
        try {
            this.worker = create();
        } catch (error) {
            throw new NoiseEngineError(`This browser couldn’t start the noise remover’s worker (${(error as Error)?.message || error}).`, "worker");
        }
        this.worker.onmessage = (event: MessageEvent<NoiseReply>) => this.receive(event.data);
        this.worker.onerror = (event: Event) => {
            event.preventDefault?.();
            const message = (event as ErrorEvent).message;
            this.fail(!this.loaded && !message
                ? withErrorKind(new Error("The noise remover couldn’t be downloaded."), "network")
                : new NoiseEngineError(`The noise remover stopped in this browser${message ? ` (${message})` : ""}.`, "stopped"));
        };
        this.worker.onmessageerror = () => this.fail(new NoiseEngineError("The noise remover sent an answer this page couldn’t read.", "stopped"));
    }

    private receive(reply: NoiseReply) {
        if (reply.type === "loaded") { this.loaded = true; return; }
        if (reply.type === "progress") { this.onProgress(reply.seconds); return; }
        if (reply.type === "taken") {
            this.inFlight--;
            const room = this.waitingForRoom;
            this.waitingForRoom = null;
            room?.();
            return;
        }
        if (reply.type === "error") {
            const error = new NoiseEngineError(reply.message, "stopped");
            // Running out of memory reads as a RangeError or InternalError that says so; mark it for the message.
            if (outOfMemory(reply)) (error as { cause?: string }).cause = "memory";
            this.fail(error);
            return;
        }
        const waiting = this.waitingFor;
        if (waiting && waiting.type === reply.type) {
            this.waitingFor = null;
            waiting.resolve(reply);
        }
    }

    /** End the worker; whatever waits on it fails with `error`. */
    fail(error: Error) {
        if (this.stopped) return;
        this.stopped = true;
        this.failure = error;
        this.worker.terminate();
        for (const reject of this.failed.splice(0)) reject(error);
        this.waitingFor = null;
        this.waitingForRoom = null;
    }

    private wait(type: "ready" | "done"): Promise<NoiseReply> {
        return new Promise((resolve, reject) => {
            if (this.failure) { reject(this.failure); return; }
            this.failed.push(reject);
            this.waitingFor = { type, resolve };
        });
    }

    private post(message: NoiseRequest, transfer: Transferable[] = []) {
        if (this.failure) throw this.failure;
        this.worker.postMessage(message, transfer);
    }

    async start(module: WebAssembly.Module, strength: number) {
        const ready = this.wait("ready");
        this.post({ type: "start", module, strength });
        await ready;
    }

    /** Hand over the next piece once fewer than IN_FLIGHT are waiting. */
    async send(item: SourceItem) {
        while (this.inFlight >= IN_FLIGHT) {
            await new Promise<void>((resolve, reject) => {
                if (this.failure) { reject(this.failure); return; }
                this.failed.push(reject);
                this.waitingForRoom = resolve;
            });
        }
        this.inFlight++;
        if (item.kind === "pcm") this.post({ type: "pcm", channels: item.channels, rate: item.rate, start: item.start, lead: item.lead }, item.channels.map(channel => channel.buffer));
        else if (item.kind === "wav") this.post({ type: "wav", bytes: item.bytes, start: item.start }, [item.bytes]);
        else this.post({ type: "gap", seconds: item.seconds });
    }

    async finish(): Promise<{ wav: Blob; stats: NoiseStats }> {
        const done = this.wait("done");
        this.post({ type: "end" });
        const reply = (await done) as Extract<NoiseReply, { type: "done" }>;
        return { wav: reply.wav, stats: reply.stats };
    }

    terminate() {
        this.fail(abortError());
    }
}

export type NoiseStage = "reading" | "starting" | "cleaning";

export interface NoiseRunOptions {
    /** How much of the cleaned sound to keep, 0 to 1. */
    strength: number;
    signal?: AbortSignal;
    onStage?: (stage: NoiseStage) => void;
    /** How far through the file the readers that walk it have got, 0 to 1. */
    onRead?: (fraction: number) => void;
    /** Seconds of sound cleaned, of `total`. */
    onProgress?: (seconds: number, total: number) => void;
    /** Stand-ins, for tests. */
    createWorker?: WorkerFactory;
    decode?: Decode;
    loadModule?: () => Promise<WebAssembly.Module>;
    pieceSeconds?: number;
}

export interface NoiseResult {
    wav: Blob;
    /** Seconds of sound in the result. */
    seconds: number;
    stats: NoiseStats;
    /** Stretches this browser couldn't decode, silent in the result. */
    gaps: { start: number; end: number }[];
    container: string;
}

/** Clean a recording's background noise, in this browser. */
export async function removeNoise(file: File, options: NoiseRunOptions): Promise<NoiseResult> {
    const { signal } = options;
    signal?.throwIfAborted();
    options.onStage?.("reading");
    const source = await openNoiseSource(file, { signal, decode: options.decode, pieceSeconds: options.pieceSeconds, onRead: bytes => options.onRead?.(file.size ? bytes / file.size : 1) });
    const items = source.items();
    try {
        // The first piece is decoded before RNNoise is loaded: a file this browser can't read fails here.
        let item = await items.next();
        signal?.throwIfAborted();
        if (item.done) throw new NoiseInputError("no-sound", "This file holds no sound, so there is nothing to clean.");
        options.onStage?.("starting");
        const module = await (options.loadModule ?? loadRnnoiseModule)();
        signal?.throwIfAborted();
        const worker = new NoiseWorker(options.createWorker ?? startWorker, seconds => options.onProgress?.(seconds, source.durationSeconds));
        const stop = () => worker.terminate();
        signal?.addEventListener("abort", stop, { once: true });
        try {
            await worker.start(module, options.strength);
            options.onStage?.("cleaning");
            options.onProgress?.(0, source.durationSeconds);
            const gaps: { start: number; end: number }[] = [];
            while (!item.done) {
                if (item.value.kind === "gap") gaps.push({ start: item.value.start, end: item.value.start + item.value.seconds });
                await worker.send(item.value);
                item = await items.next();
                signal?.throwIfAborted();
            }
            const { wav, stats } = await worker.finish();
            return { wav, stats, gaps, seconds: stats.frames / RNNOISE_RATE, container: source.container };
        } finally {
            signal?.removeEventListener("abort", stop);
            worker.terminate();
        }
    } finally {
        await items.return(undefined);
    }
}
