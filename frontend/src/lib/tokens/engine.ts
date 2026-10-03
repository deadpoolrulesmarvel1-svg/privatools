/**
 * Where the token counter's work (jobs.ts) runs.
 *
 * In workers, when the browser starts them: one per encoding
 * (tokens-o200k.worker.ts and tokens-cl100k.worker.ts), counting side by
 * side. The page keeps drawing and taking clicks however long a count takes,
 * and Cancel ends the workers, which stops the work at once, even inside one
 * long step of the tokenizer. The next job starts new ones. Where no worker
 * starts, the same work runs on the page a slice at a time, checking for
 * Cancel between slices.
 */
import { readDocxText } from "./docx";
import { loadGptEncoder } from "./encoders";
import { abortError, tagged } from "./errors";
import { GPT_ENCODINGS, throwIfAborted, type GptEncodingId } from "./gpt";
import { countText, splitText, type PartialCounts, type TextCounts } from "./jobs";
import { failureError, type TokenReply, type TokenRequest } from "./protocol";
import type { Chunk } from "./split";

export interface EngineOptions {
    signal?: AbortSignal;
    /** How far the job has come, from 0 to 1, and what it is doing. */
    onProgress?: (fraction: number, detail?: string) => void;
}

export interface TokenEngine {
    /** A Word file's body text. Its bytes move to a worker, so the caller can't use them afterwards. */
    readDocx(bytes: Uint8Array, name: string, options?: EngineOptions): Promise<string>;
    count(text: string, options?: EngineOptions): Promise<TextCounts>;
    split(text: string, maxTokens: number, encoding: GptEncodingId, options?: EngineOptions): Promise<Chunk[]>;
    /** End the workers, if any run, and whatever they are doing; the next job starts new ones. */
    stop(): void;
}

export type WorkerFactory = (encoding: GptEncodingId) => Worker;

/** Vite builds each worker, with everything it imports, into a script of its own. */
const startWorker: WorkerFactory = encoding => encoding === "o200k_base"
    ? new Worker(new URL("./tokens-o200k.worker.ts", import.meta.url), { type: "module", name: "tokens-o200k" })
    : new Worker(new URL("./tokens-cl100k.worker.ts", import.meta.url), { type: "module", name: "tokens-cl100k" });

/** The worker that reads Word files: cl100k_base's, the smaller script. */
const READS_DOCX: GptEncodingId = "cl100k_base";
const BOTH = GPT_ENCODINGS.map(encoding => encoding.id).join(" and ");

type Unnumbered<T> = T extends unknown ? Omit<T, "id"> : never;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onProgress?: EngineOptions["onProgress"];
}

class TokenWorker {
    private readonly worker: Worker;
    private readonly pending = new Map<number, Pending>();
    private next = 1;
    /** Whether the script has loaded; a failure before then, with no error message, is a download that failed. */
    private loaded = false;
    stopped = false;

    constructor(create: () => Worker) {
        this.worker = create();
        this.worker.onmessage = (event: MessageEvent<TokenReply>) => this.receive(event.data);
        this.worker.onerror = (event: Event) => {
            event.preventDefault?.();
            const download = !this.loaded && !(event as ErrorEvent).message;
            this.fail(download
                ? tagged(new Error("The token counter couldn’t be downloaded."), "network")
                : new Error("The token counter stopped in this browser."));
        };
        this.worker.onmessageerror = () => this.fail(new Error("The token counter sent an answer this page couldn’t read."));
    }

    private receive(reply: TokenReply) {
        if (reply.type === "ready") { this.loaded = true; return; }
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        if (reply.type === "progress") { waiting.onProgress?.(reply.fraction, reply.detail); return; }
        this.pending.delete(reply.id);
        if (reply.type === "error") waiting.reject(failureError(reply.error));
        else waiting.resolve(reply.value);
    }

    /** End the worker; whatever waits on it fails with `error`. */
    fail(error: Error) {
        if (this.stopped) return;
        this.stopped = true;
        this.worker.terminate();
        const waiting = [...this.pending.values()];
        this.pending.clear();
        for (const job of waiting) job.reject(error);
    }

    request<T>(message: Unnumbered<TokenRequest>, { signal, onProgress }: EngineOptions, transfer: Transferable[] = []): Promise<T> {
        if (signal?.aborted) return Promise.reject(abortError());
        if (this.stopped) return Promise.reject(new Error("The token counter has stopped."));
        const id = this.next++;
        return new Promise<T>((resolve, reject) => {
            // Cancel ends the worker, and so the job, wherever it is.
            const cancel = () => this.fail(abortError());
            const settled = () => signal?.removeEventListener("abort", cancel);
            this.pending.set(id, {
                resolve: value => { settled(); resolve(value as T); },
                reject: error => { settled(); reject(error); },
                onProgress,
            });
            signal?.addEventListener("abort", cancel, { once: true });
            this.worker.postMessage({ ...message, id }, transfer);
        });
    }
}

/** The token counter's jobs, in workers where `create` starts them, else on the page. */
export function createTokenEngine(create: WorkerFactory | null = typeof Worker === "function" ? startWorker : null): TokenEngine {
    let factory = create;
    const running = new Map<GptEncodingId, TokenWorker>();
    /** The worker for an encoding, started if need be; null once workers have failed to start, and from then on. */
    const connection = (encoding: GptEncodingId): TokenWorker | null => {
        const current = running.get(encoding);
        if (current && !current.stopped) return current;
        running.delete(encoding);
        if (!factory) return null;
        try {
            const worker = new TokenWorker(() => factory!(encoding));
            running.set(encoding, worker);
            return worker;
        } catch {
            // This browser starts no such worker (module workers came late to some): the page does the work from now on.
            factory = null;
            stopAll();
            return null;
        }
    };
    const stopAll = (error: Error = abortError()) => {
        for (const worker of running.values()) worker.fail(error);
        running.clear();
    };
    const workers = (): TokenWorker[] | null => {
        const all = GPT_ENCODINGS.map(encoding => connection(encoding.id));
        return all.every(Boolean) ? (all as TokenWorker[]) : null;
    };

    return {
        async readDocx(bytes, name, options = {}) {
            const pair = workers();
            if (!pair) {
                throwIfAborted(options.signal);
                return readDocxText(bytes, { name });
            }
            // Both workers start now; the other one loads while this one reads.
            const reader = pair[GPT_ENCODINGS.findIndex(encoding => encoding.id === READS_DOCX)];
            const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
            return reader.request<string>({ type: "docx", bytes, name }, options, whole ? [bytes.buffer as ArrayBuffer] : []);
        },

        async count(text, { signal, onProgress } = {}) {
            const pair = workers();
            if (!pair) {
                const encoders = await Promise.all(GPT_ENCODINGS.map(async ({ id }) => ({ id, encoder: await loadGptEncoder(id) })));
                return await countText(text, encoders, { signal, onProgress, yields: true }) as TextCounts;
            }
            // Each worker counts its own encoding, at the same time; the slower one sets the pace.
            const fractions = pair.map(() => 0);
            const done = pair.map(() => false);
            const report = () => onProgress?.(Math.min(...fractions), BOTH);
            try {
                const parts = await Promise.all(pair.map((worker, index) => worker.request<PartialCounts>({ type: "count", text }, {
                    signal,
                    onProgress: fraction => { fractions[index] = fraction; report(); },
                }).finally(() => { done[index] = true; })));
                return { ...parts[0], gpt: Object.assign({}, ...parts.map(part => part.gpt)) } as TextCounts;
            } catch (error) {
                // One failed: whatever the other is still doing is no longer wanted.
                pair.forEach((worker, index) => { if (!done[index]) worker.fail(abortError()); });
                throw error;
            }
        },

        async split(text, maxTokens, encoding, options = {}) {
            const worker = connection(encoding);
            if (!worker) return splitText(text, maxTokens, { id: encoding, encoder: await loadGptEncoder(encoding) }, { ...options, yields: true });
            return worker.request<Chunk[]>({ type: "split", text, maxTokens, encoding }, options);
        },

        stop() {
            stopAll();
        },
    };
}
