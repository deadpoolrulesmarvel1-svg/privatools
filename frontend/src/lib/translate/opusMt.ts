/**
 * OPUS-MT on this device, shared by Translate PDF and Subtitle Translator.
 *
 * One model per language pair (lib/translate/languages.ts), loaded by
 * transformers.js from Hugging Face on first use and kept in the browser's
 * Cache API ("transformers-cache"), where the AI hub lists it
 * (lib/localModels.ts). The worker reads and writes that same cache, so a
 * pair either tool downloaded, on any version of the page, is found by the
 * other.
 *
 * The model runs in a worker (opusMt.worker.ts, which runs opusMt-core.ts).
 * On the page's thread, loading it kept the page from drawing or taking a
 * click, Cancel included, for 3.8 to 7.4 seconds on a two-core machine, and a
 * long piece's translation for up to 2.5. The worker starts from a blob: URL
 * so it runs under the page's own policy, which allows the model runtime;
 * where a worker cannot run the model, the same core runs on the page,
 * giving the page a turn between the model's steps.
 *
 * The tokenizer is the model's, so the pieces text is cut into (chunk.ts,
 * counted in the model's own tokens) are cut where the model is, and the page
 * asks for them by message. A model step runs to its end whether or not
 * anyone still waits for it, so stopDeviceTranslator ends the worker: the
 * tools call it on Cancel, when they close and after a run fails, and the
 * page calls it when it is hidden for good or put away. The next run starts
 * a new worker, which loads the model from the browser's cache.
 */
import workerUrl from "./opusMt.worker?worker&url";
import { withErrorKind } from "@/lib/api";
import { removeCachedModel } from "@/lib/localModels";
import { yieldBetweenSteps } from "@/lib/modelSteps";
import type { TokenRun } from "./chunk";
import { APPROX_MODEL_MB } from "./languages";
import { MAX_INPUT_TOKENS, outputBudget } from "./limits";
import type { OpusMtCore } from "./opusMt-core";
import { errorReply, type OpusMtReply, type OpusMtRequest } from "./opusMt-protocol";

export { MAX_INPUT_TOKENS, outputBudget };

/** What a model's load is doing, where the page can say so: downloading its files, or building the model from them. */
export type ModelStage = "download" | "prepare";

export interface DeviceTranslator {
    readonly modelId: string;
    /** Each text in pieces the model reads whole, counted in its own tokens (chunk.ts's chunkByTokens). */
    chunk(texts: readonly string[], maxTokens: number): Promise<string[][]>;
    /** A passage's texts in the runs translated together, with each run's pieces (chunk.ts's tokenRuns). */
    runs(texts: readonly string[], maxTokens: number): Promise<TokenRun[]>;
    /** One piece's translation; `maxNewTokens` defaults to the budget for its length. */
    translate(text: string, maxNewTokens?: number): Promise<string>;
}

/** A request as the page writes it; the connection numbers it. */
type Unnumbered<T> = T extends unknown ? Omit<T, "id"> : never;
/** What the model's side says about a load before it answers. */
export type LoadNews = Extract<OpusMtReply, { type: "progress" | "downloading" | "preparing" }>;

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; onNews?: (news: LoadNews) => void }

/** An error from the model's side, with its name, and tagged as the network's when a download failed. */
function modelError(reply: Extract<OpusMtReply, { type: "error" }>): Error {
    const error = new Error(reply.message);
    error.name = reply.name;
    return reply.network ? withErrorKind(error, "network") : error;
}

/** Numbered requests to the model's side and their answers, wherever the model runs. */
abstract class Connection {
    private next = 1;
    private readonly pending = new Map<number, Pending>();
    broken = false;

    protected abstract send(message: OpusMtRequest): void;
    protected abstract end(): void;

    protected receive(reply: OpusMtReply) {
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        if (reply.type === "progress" || reply.type === "downloading" || reply.type === "preparing") { waiting.onNews?.(reply); return; }
        this.pending.delete(reply.id);
        if (reply.type === "error") waiting.reject(modelError(reply));
        else waiting.resolve(reply.type === "result" ? reply.output : undefined);
    }

    protected fail(error: Error) {
        if (this.broken) return;
        this.broken = true;
        for (const waiting of this.pending.values()) waiting.reject(error);
        this.pending.clear();
        this.end();
    }

    /** End the model's side and whatever it is doing; whatever waits on it fails as stopped. */
    terminate(): void {
        const stopped = new Error("The translation was stopped.");
        stopped.name = "AbortError";
        this.fail(stopped);
    }

    request(message: Unnumbered<OpusMtRequest>, onNews?: (news: LoadNews) => void): Promise<unknown> {
        if (this.broken) return Promise.reject(new Error("The translation worker has stopped."));
        const id = this.next++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onNews });
            this.send({ ...message, id } as OpusMtRequest);
        });
    }
}

export class OpusMtWorker extends Connection {
    private readonly worker: Worker;
    /** The blob: address the worker started from, released once the worker has answered. */
    private wrapper: string | null;

    constructor(create: (wrapper: string) => Worker = wrapper => new Worker(wrapper, { name: "opus-mt" })) {
        super();
        // A blob: worker runs under the page's policy; one loaded from its own URL would get that URL's, which forbids WebAssembly.
        const script = new URL(workerUrl, location.href).href;
        this.wrapper = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(script)});`], { type: "text/javascript" }));
        this.worker = create(this.wrapper);
        this.worker.onmessage = (event: MessageEvent<OpusMtReply>) => {
            // Its first answer means the worker has loaded its script, so the address it came from can go.
            this.release();
            this.receive(event.data);
        };
        this.worker.onerror = event => { event.preventDefault?.(); this.fail(new Error(event.message || "The translation worker stopped.")); };
        this.worker.onmessageerror = () => this.fail(new Error("The translation worker sent a message the page could not read."));
    }

    private release() {
        if (this.wrapper) URL.revokeObjectURL(this.wrapper);
        this.wrapper = null;
    }

    protected send(message: OpusMtRequest) {
        this.worker.postMessage(message);
    }

    protected end() {
        this.worker.terminate();
        this.release();
    }
}

/**
 * The model on the page's own thread, where no worker can run it: the same
 * core, with a turn for the page before each of the model's steps. Stopping
 * it stops the waiting, not a step already running.
 */
class OnPage extends Connection {
    private core: Promise<OpusMtCore> | null = null;
    private queue: Promise<void> = Promise.resolve();

    protected send(message: OpusMtRequest) {
        // Imported only here, so the page loads transformers.js only when it must run the model itself.
        const core = this.core ??= import("./opusMt-core").then(({ createOpusMtCore }) => createOpusMtCore(reply => this.receive(reply), { prepare: yieldBetweenSteps }));
        this.queue = this.queue.then(async () => {
            if (this.broken) return;
            try {
                await (await core).handle(message);
            } catch (error) {
                this.receive(errorReply(message.id, error));
            }
        });
    }

    protected end() {}
}

let worker: OpusMtWorker | null | undefined;
let onPage: OnPage | undefined;
let watchingPage = false;

/**
 * Stop OPUS-MT on this page: end the worker, so a model step for a run that
 * nobody waits for any more stops using the processor and memory. The next
 * run starts a new worker, which loads the model from the browser's cache.
 */
export function stopDeviceTranslator(): void {
    worker?.terminate();
    worker = undefined;
    onPage?.terminate();
    onPage = undefined;
}

/** The page's OPUS-MT worker, or null where workers cannot start. A worker that stopped is replaced. */
function translatorWorker(): OpusMtWorker | null {
    if (worker?.broken) worker = undefined;
    if (worker === undefined) {
        try {
            worker = typeof Worker === "function" && typeof URL.createObjectURL === "function" ? new OpusMtWorker() : null;
        } catch {
            worker = null;
        }
        // A page that is closed, or put away in the back-forward cache, needs no model running.
        if (worker && !watchingPage && typeof addEventListener === "function") {
            addEventListener("pagehide", stopDeviceTranslator);
            watchingPage = true;
        }
    }
    return worker;
}

/** How many loads of each model this page has started: a later one makes an earlier cancel's clean-up stand down. */
const loadsStarted = new Map<string, number>();

/**
 * A load stopped while its files were still downloading leaves some of them
 * in the cache, which the AI hub and Subtitle Translator would show as the
 * model being in this browser. Clear them now, and once more shortly after:
 * a file the worker had already handed to the browser to keep can still be
 * written after the worker has stopped. A new load of the model skips the
 * second pass, since its own files are arriving.
 */
async function forgetPartial(modelId: string): Promise<void> {
    const started = loadsStarted.get(modelId);
    await removeCachedModel(modelId).catch(() => {});
    setTimeout(() => {
        if (loadsStarted.get(modelId) === started) void removeCachedModel(modelId).catch(() => {});
    }, 2000);
}

/** The pair's translator, through `connection`. */
function through(connection: Connection, modelId: string): DeviceTranslator {
    return {
        modelId,
        chunk: (texts, maxTokens) => connection.request({ type: "chunk", modelId, texts: [...texts], maxTokens }) as Promise<string[][]>,
        runs: (texts, maxTokens) => connection.request({ type: "runs", modelId, texts: [...texts], maxTokens }) as Promise<TokenRun[]>,
        translate: (text, maxNewTokens) => connection.request({ type: "translate", modelId, text, maxNewTokens }) as Promise<string>,
    };
}

async function loadThrough(connection: Connection, modelId: string, onProgress: (percent: number) => void, onStage?: (stage: ModelStage) => void): Promise<DeviceTranslator> {
    loadsStarted.set(modelId, (loadsStarted.get(modelId) ?? 0) + 1);
    const state: { stage: ModelStage | null } = { stage: null };
    try {
        await connection.request({ type: "load", modelId, bytes: APPROX_MODEL_MB * 1024 * 1024 }, news => {
            if (news.type === "progress") { onProgress(news.percent); return; }
            state.stage = news.type === "downloading" ? "download" : "prepare";
            onStage?.(state.stage);
        });
    } catch (error) {
        if ((error as { name?: string }).name === "AbortError" && state.stage === "download") await forgetPartial(modelId);
        throw error;
    }
    onProgress(100);
    return through(connection, modelId);
}

/**
 * The pair's model, downloading it first if this browser does not have it.
 * `onProgress` hears how much of its files has arrived, in percent, and 100
 * once it is ready; `onStage` hears when a file starts to download from
 * Hugging Face, and when every file is here and the model is being built
 * from them, which has no measure of its own.
 */
export async function loadDeviceTranslator(modelId: string, onProgress: (percent: number) => void, onStage?: (stage: ModelStage) => void): Promise<DeviceTranslator> {
    const inWorker = translatorWorker();
    if (inWorker) {
        try {
            return await loadThrough(inWorker, modelId, onProgress, onStage);
        } catch (error) {
            // A download that failed would fail on the page too, and a load stopped by stopDeviceTranslator
            // was stopped on purpose: say so. Anything else means this browser cannot run the model in a
            // worker, so it runs on the page, and that worker goes with whatever it holds.
            const { __kind, name } = error as { __kind?: string; name?: string };
            if (__kind === "network" || name === "AbortError") throw error;
            inWorker.terminate();
        }
    }
    if (!onPage || onPage.broken) onPage = new OnPage();
    return loadThrough(onPage, modelId, onProgress, onStage);
}
