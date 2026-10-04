/**
 * Whisper on this device, shared by Transcribe Audio and Subtitle Generator.
 *
 * The two models are the ones in the model registry (lib/localModels.ts),
 * loaded by transformers.js the way the registry's own download loads them,
 * so the files one tool or the AI hub fetched are the files the other uses:
 * downloaded once from Hugging Face, kept in the browser's Cache API, and
 * listed and removed by the AI hub.
 *
 * Whisper runs in a worker (whisper.worker.ts). On the page's own thread one
 * 30-second window kept the page from drawing or taking a click for up to 18
 * seconds on a two-core machine, most of it in a single step of the model.
 * The worker starts from a blob: URL so it runs under the page's own policy,
 * which allows the model runtime; where a worker cannot run Whisper, it runs
 * on the page instead, giving the page a turn between steps.
 *
 * A model step in the worker runs to its end whether or not anyone still
 * waits for it, and transformers.js runs a model's steps one after another,
 * so a run that is cancelled or left behind would keep the processor busy
 * and hold up the next one. stopWhisper ends the worker: the tools call it
 * on cancel, when they close, and after a run fails, and the page calls it
 * when it is hidden for good or put away.
 */
import workerUrl from "./whisper.worker?worker&url";
import { withErrorKind } from "./api";
import { LOCAL_MODELS } from "./localModels";
import { modelProgress } from "./modelProgress";
import { yieldBetweenSteps } from "./modelSteps";
import { configureTransformers } from "./transformersEnv";
import type { WhisperReply, WhisperRequest } from "./whisper-protocol";

export type WhisperSize = "tiny" | "base";

/** Whisper hears 16 kHz mono. */
export const WHISPER_SAMPLE_RATE = 16000;

/**
 * A Whisper pipeline: 16 kHz mono in, text and, with `return_timestamps`,
 * timed chunks out. `onPosition`, where it is heard, says how many seconds
 * into the audio Whisper has written so far.
 */
export type WhisperPipeline = (audio: Float32Array, options: Record<string, unknown>, onPosition?: (seconds: number) => void) => Promise<{
    text?: string;
    chunks?: Array<{ timestamp: [number | null, number | null]; text: string }>;
}>;

function registered(id: string) {
    const model = LOCAL_MODELS.find(entry => entry.id === id);
    if (!model) throw new Error(`${id} is missing from the model registry`);
    return model;
}

function model(id: string, label: string) {
    const { hfId, approxLabel } = registered(id);
    // "~74 MB": the expected download, which keeps the progress honest before the real sizes arrive.
    return { hfId, label, size: approxLabel, bytes: Number.parseInt(approxLabel.replace(/\D/g, ""), 10) * 1024 * 1024 };
}

export const WHISPER: Record<WhisperSize, { hfId: string; label: string; size: string; bytes: number }> = {
    tiny: model("whisper-tiny", "Tiny"),
    base: model("whisper-base", "Base"),
};

/** Mix to mono. 5.1 keeps its centre, where speech is, at full weight and leaves out the LFE channel. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
    if (channels.length === 1) return channels[0];
    const weights = channels.length === 6 ? [0.5, 0.5, 1, 0, 0.35, 0.35] : channels.map(() => 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const length = Math.min(...channels.map(channel => channel.length));
    const mono = new Float32Array(length);
    channels.forEach((channel, c) => {
        const weight = weights[c] / total;
        if (weight) for (let i = 0; i < length; i++) mono[i] += channel[i] * weight;
    });
    return mono;
}

/**
 * Decode a complete audio stream with the browser's own decoder, resampled to
 * 16 kHz and mixed to mono. An offline context touches no audio device.
 */
export async function decodeToMono(bytes: ArrayBuffer): Promise<Float32Array> {
    const context = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
    const audio = await context.decodeAudioData(bytes);
    return mixToMono(Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c)));
}

/* ── In a worker ─────────────────────────────────────────────────────── */

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: (percent: number) => void }

/** A request as the page writes it; the worker connection numbers it. */
type Unnumbered<T> = T extends unknown ? Omit<T, "id"> : never;

/** An error from the worker, with its name, and tagged as the network's when a download failed. */
function workerError(reply: Extract<WhisperReply, { type: "error" }>): Error {
    const error = new Error(reply.message);
    error.name = reply.name;
    return reply.network ? withErrorKind(error, "network") : error;
}

export class WhisperWorker {
    private readonly worker: Worker;
    private next = 1;
    private readonly pending = new Map<number, Pending>();
    /** The blob: address the worker started from, released once the worker has answered. */
    private wrapper: string | null;
    broken = false;

    constructor(create: (wrapper: string) => Worker = wrapper => new Worker(wrapper, { name: "whisper" })) {
        // A blob: worker runs under the page's policy; one loaded from its own URL would get that URL's, which forbids WebAssembly.
        const script = new URL(workerUrl, location.href).href;
        this.wrapper = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(script)});`], { type: "text/javascript" }));
        this.worker = create(this.wrapper);
        this.worker.onmessage = (event: MessageEvent<WhisperReply>) => this.receive(event.data);
        this.worker.onerror = event => { event.preventDefault?.(); this.fail(new Error(event.message || "The Whisper worker stopped.")); };
        this.worker.onmessageerror = () => this.fail(new Error("The Whisper worker sent a message the page could not read."));
    }

    private release() {
        if (this.wrapper) URL.revokeObjectURL(this.wrapper);
        this.wrapper = null;
    }

    private receive(reply: WhisperReply) {
        // Its first answer means the worker has loaded its script, so the address it came from can go.
        this.release();
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        if (reply.type === "progress") { waiting.onProgress?.(reply.percent); return; }
        if (reply.type === "position") { waiting.onProgress?.(reply.seconds); return; }
        this.pending.delete(reply.id);
        if (reply.type === "error") waiting.reject(workerError(reply));
        else waiting.resolve(reply.type === "result" ? reply.output : undefined);
    }

    private fail(error: Error) {
        if (this.broken) return;
        this.broken = true;
        for (const waiting of this.pending.values()) waiting.reject(error);
        this.pending.clear();
        this.worker.terminate();
        this.release();
    }

    /** End the worker and whatever it is doing; whatever waits on it fails as stopped. */
    terminate(): void {
        const stopped = new Error("Whisper was stopped.");
        stopped.name = "AbortError";
        this.fail(stopped);
    }

    request(message: Unnumbered<WhisperRequest>, onProgress?: (percent: number) => void, transfer: Transferable[] = []): Promise<unknown> {
        if (this.broken) return Promise.reject(new Error("The Whisper worker has stopped."));
        const id = this.next++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onProgress });
            this.worker.postMessage({ ...message, id }, transfer);
        });
    }
}

let shared: WhisperWorker | null | undefined;
let watchingPage = false;

/**
 * Stop Whisper on this page: end the worker, so a model step for a run that
 * nobody waits for any more stops using the processor and memory. The next
 * run starts a new worker, which loads the model from the browser's cache.
 */
export function stopWhisper(): void {
    shared?.terminate();
    shared = undefined;
}

/** The page's Whisper worker, or null where workers cannot start. A worker that stopped is replaced. */
function whisperWorker(): WhisperWorker | null {
    if (shared?.broken) shared = undefined;
    if (shared === undefined) {
        try {
            shared = typeof Worker === "function" && typeof URL.createObjectURL === "function" ? new WhisperWorker() : null;
        } catch {
            shared = null;
        }
        // A page that is closed, or put away in the back-forward cache, needs no Whisper running.
        if (shared && !watchingPage && typeof addEventListener === "function") {
            addEventListener("pagehide", stopWhisper);
            watchingPage = true;
        }
    }
    return shared;
}

/* ── On the page ─────────────────────────────────────────────────────── */

const pipelines = new Map<string, Promise<WhisperPipeline>>();

/**
 * On the page's thread a window of speech is a long run of model steps that
 * only await microtasks; lib/modelSteps gives the page a turn between them,
 * though not during one step, which can itself take seconds.
 */
export { yieldBetweenSteps };

async function loadOnPage(size: WhisperSize, onProgress: (percent: number) => void): Promise<WhisperPipeline> {
    const { hfId, bytes } = WHISPER[size];
    const cached = pipelines.get(hfId);
    if (cached) {
        const pipeline = await cached;
        onProgress(100);
        return pipeline;
    }
    const loading = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        configureTransformers(env);
        const asr = await pipeline("automatic-speech-recognition", hfId, {
            progress_callback: modelProgress(onProgress, bytes),
        } as never);
        yieldBetweenSteps(asr);
        return asr as unknown as WhisperPipeline;
    })();
    pipelines.set(hfId, loading);
    try {
        return await loading;
    } catch (error) {
        pipelines.delete(hfId);
        throw error;
    }
}

/**
 * The model's pipeline, downloading it first if this browser does not have
 * it. `onProgress` hears the download in percent, with 100 once it is ready.
 */
export async function loadWhisper(size: WhisperSize, onProgress: (percent: number) => void): Promise<WhisperPipeline> {
    const { hfId, bytes } = WHISPER[size];
    const worker = whisperWorker();
    if (worker) {
        try {
            await worker.request({ type: "load", hfId, bytes }, onProgress);
            onProgress(100);
            return (audio, options, onPosition) => {
                // The audio may be a view into a longer buffer the caller still needs: send a copy.
                const copy = audio.slice();
                return worker.request({ type: "run", hfId, audio: copy, options, positions: Boolean(onPosition) }, onPosition, [copy.buffer]) as ReturnType<WhisperPipeline>;
            };
        } catch (error) {
            // A download that failed would fail on the page too, and a load stopped by stopWhisper
            // was stopped on purpose: say so. Anything else means this browser cannot run Whisper
            // in a worker, so it runs on the page.
            const { __kind, name } = error as { __kind?: string; name?: string };
            if (__kind === "network" || name === "AbortError") throw error;
        }
    }
    return loadOnPage(size, onProgress);
}
