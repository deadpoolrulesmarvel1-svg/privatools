/**
 * GPT token counts, exact and on this device, with gpt-tokenizer (MIT, pinned
 * in package.json): a JavaScript port of OpenAI's tiktoken encodings. Each
 * encoding's rank table is a large module, about 2.4 MB (o200k_base) and
 * 1.2 MB (cl100k_base) before compression, so it is imported only when a
 * count needs it; the browser then keeps it like any other script.
 */

export type GptEncodingId = "o200k_base" | "cl100k_base";

export interface GptEncodingInfo {
    id: GptEncodingId;
    /** Models gpt-tokenizer maps to this encoding, as people write them. */
    models: readonly string[];
    /** The same models, as gpt-tokenizer names them: gpt.test.ts checks each against the package's own map. */
    modelIds: readonly string[];
}

/** Only models the package itself maps to each encoding; never one it doesn't. */
export const GPT_ENCODINGS: readonly GptEncodingInfo[] = [
    {
        id: "o200k_base",
        models: ["GPT-5.5", "GPT-5", "GPT-4.1", "GPT-4o", "o4-mini", "o3", "o1"],
        modelIds: ["gpt-5.5", "gpt-5", "gpt-4.1", "gpt-4o", "o4-mini", "o3", "o1"],
    },
    {
        id: "cl100k_base",
        models: ["GPT-4", "GPT-4 Turbo", "GPT-3.5 Turbo"],
        modelIds: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
    },
];

export function gptEncoding(id: GptEncodingId): GptEncodingInfo {
    return GPT_ENCODINGS.find(encoding => encoding.id === id)!;
}

/** "GPT-4, GPT-4 Turbo and GPT-3.5 Turbo". */
export function modelList(models: readonly string[]): string {
    return models.length < 2 ? models.join("") : `${models.slice(0, -1).join(", ")} and ${models[models.length - 1]}`;
}

interface EncodeOptions { disallowedSpecial?: Set<string> }

/** The part of gpt-tokenizer's encoding API this page uses. */
export interface GptEncoder {
    /** One array of tokens per piece of text (a word, a number, a run of punctuation or space), in order. */
    encodeGenerator(text: string, options?: EncodeOptions): Iterable<number[]>;
    countTokens(text: string, options?: EncodeOptions): number;
    decode(tokens: Iterable<number>): string;
}

/**
 * How text is encoded here: a string such as <|endoftext|> in a prompt is
 * ordinary text, counted as the characters it is. gpt-tokenizer's default
 * refuses such text outright; OpenAI's API treats it as text too.
 */
export const AS_PLAIN_TEXT: EncodeOptions = Object.freeze({ disallowedSpecial: new Set<string>() });

const loaded = new Map<GptEncodingId, Promise<GptEncoder>>();

export function loadGptEncoder(id: GptEncodingId): Promise<GptEncoder> {
    let encoder = loaded.get(id);
    if (!encoder) {
        encoder = (id === "o200k_base" ? import("gpt-tokenizer/encoding/o200k_base") : import("gpt-tokenizer/encoding/cl100k_base"))
            .then(module => module as GptEncoder);
        // A failed download may succeed on the next attempt.
        encoder.catch(() => loaded.delete(id));
        loaded.set(id, encoder);
    }
    return encoder;
}

/** Lets the page paint and take input between slices of work. */
export function nextTask(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function abortError(): DOMException {
    return new DOMException("The count was cancelled.", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError();
}

export interface ScanOptions {
    signal?: AbortSignal;
    /** Characters read so far; called between slices and once at the end. */
    onProgress?: (done: number, total: number) => void;
    /** How long to work before giving the page a turn. */
    sliceMs?: number;
}

/**
 * Walk the text piece by piece, as the encoder splits it before merging
 * bytes into tokens. The pieces cover the text end to end, so their lengths
 * add up to the text's and the tokens to its exact count; between slices the
 * page gets a turn, so a long text neither freezes the tab nor stops Cancel.
 */
export async function scanPieces(
    text: string, encoder: GptEncoder,
    onPiece: (piece: string, tokens: number) => void,
    { signal, onProgress, sliceMs = 30 }: ScanOptions = {},
): Promise<void> {
    throwIfAborted(signal);
    let done = 0;
    let since = performance.now();
    let pieces = 0;
    for (const tokens of encoder.encodeGenerator(text, AS_PLAIN_TEXT)) {
        const piece = encoder.decode(tokens);
        done += piece.length;
        onPiece(piece, tokens.length);
        if (++pieces % 1024 === 0 && performance.now() - since >= sliceMs) {
            onProgress?.(done, text.length);
            await nextTask();
            throwIfAborted(signal);
            since = performance.now();
        }
    }
    onProgress?.(done, text.length);
}

/** The exact number of tokens the encoding makes of the text. */
export async function countGptTokens(text: string, encoder: GptEncoder, options: ScanOptions = {}): Promise<number> {
    let count = 0;
    await scanPieces(text, encoder, (_piece, tokens) => { count += tokens; }, options);
    return count;
}
