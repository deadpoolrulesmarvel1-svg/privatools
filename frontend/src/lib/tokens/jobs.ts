/**
 * The token counter's work, the same on either thread. engine.ts sends it to
 * the token workers (tokens-o200k.worker.ts, tokens-cl100k.worker.ts) when
 * the browser can start them, so the page keeps drawing and answering and
 * Cancel ends the work at once; where no worker starts, it runs the same
 * functions on the page, a slice at a time.
 *
 * The encoders come in as arguments: a worker passes the one table built into
 * it, the page passes those it imported (encoders.ts). Nothing here may
 * import a table, or lib/api, the page's request layer: each worker builds
 * this module and everything it imports into its own script.
 */
import { countGptTokens, type GptEncodingId, type NamedEncoder } from "./gpt";
import { splitIntoChunks, type Chunk } from "./split";
import { checkRuns } from "./runs";
import { describeFailure, type TokenReply, type TokenRequest } from "./protocol";

export interface JobOptions {
    signal?: AbortSignal;
    /** How far the job has come, from 0 to 1, and what it is doing. */
    onProgress?: (fraction: number, detail?: string) => void;
    /** Give the page a turn between slices: on the page's thread, yes; in a worker, no. */
    yields?: boolean;
}

export interface TextCounts {
    gpt: Record<GptEncodingId, number>;
    /** Characters as people count them: code points, so an emoji is one. */
    characters: number;
    /** Runs of characters between whitespace. */
    words: number;
}

/** What one worker counts: the encodings it has. */
export type PartialCounts = Omit<TextCounts, "gpt"> & { gpt: Partial<Record<GptEncodingId, number>> };

const isWideSpace = (code: number) => code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;

/**
 * Characters (code points) and words (runs between whitespace, as JavaScript's
 * \s defines it), in one pass with no allocation: the paste box shows these
 * for whatever is pasted, up to 20 million characters.
 */
export function textStats(text: string): { characters: number; words: number } {
    let characters = 0;
    let words = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0xdc00 || code > 0xdfff) characters++;
        const space = code <= 0x20 ? code === 0x20 || (code >= 0x09 && code <= 0x0d) : code >= 0xa0 && isWideSpace(code);
        if (space) inWord = false;
        else if (!inWord) { inWord = true; words++; }
    }
    return { characters, words };
}

/** The text's exact GPT count with each encoder given, with its characters and words. */
export async function countText(text: string, encoders: readonly NamedEncoder[], { signal, onProgress, yields }: JobOptions = {}): Promise<PartialCounts> {
    checkRuns(text);
    const gpt: Partial<Record<GptEncodingId, number>> = {};
    for (const [index, { id, encoder }] of encoders.entries()) {
        gpt[id] = await countGptTokens(text, encoder, {
            signal, yields,
            onProgress: (done, total) => onProgress?.((index + (total ? done / total : 1)) / encoders.length, id),
        });
    }
    return { gpt, ...textStats(text) };
}

/** The text in chunks of at most `maxTokens` tokens of one encoding. */
export async function splitText(text: string, maxTokens: number, { id, encoder }: NamedEncoder, { signal, onProgress, yields }: JobOptions = {}): Promise<Chunk[]> {
    checkRuns(text);
    return splitIntoChunks(text, maxTokens, encoder, {
        signal, yields,
        onProgress: (done, total) => onProgress?.(total ? done / total : 1, id),
    });
}

/** What a worker has to work with: its encoders, and a Word reader in the worker that reads Word files. */
export interface WorkerKit {
    encoders: readonly NamedEncoder[];
    readDocx?: (bytes: Uint8Array, name: string) => string;
}

/** One request to a worker, answered by message: progress as it goes, then the result or what went wrong. */
export async function answer(request: TokenRequest, post: (reply: TokenReply) => void, { encoders, readDocx }: WorkerKit): Promise<void> {
    const onProgress = (fraction: number, detail?: string) => post({ type: "progress", id: request.id, fraction, detail });
    try {
        let value: unknown;
        if (request.type === "docx") {
            if (!readDocx) throw new Error("This worker doesn’t read Word files.");
            value = readDocx(request.bytes, request.name);
        } else if (request.type === "count") {
            value = await countText(request.text, encoders, { onProgress, yields: false });
        } else {
            const own = encoders.find(encoder => encoder.id === request.encoding);
            if (!own) throw new Error(`This worker doesn’t count with ${request.encoding}.`);
            value = await splitText(request.text, request.maxTokens, own, { onProgress, yields: false });
        }
        post({ type: "result", id: request.id, value });
    } catch (error) {
        post({ type: "error", id: request.id, error: describeFailure(error) });
    }
}

/** Run as a worker: answer each request with this kit, after saying the script has loaded. */
export function serve(kit: WorkerKit): void {
    const scope = self as unknown as {
        postMessage(reply: TokenReply): void;
        onmessage: ((event: MessageEvent<TokenRequest>) => void) | null;
    };
    scope.onmessage = event => { void answer(event.data, reply => scope.postMessage(reply), kit); };
    scope.postMessage({ type: "ready" });
}
