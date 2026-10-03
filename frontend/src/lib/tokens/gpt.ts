/**
 * GPT token counts, exact and on this device, with gpt-tokenizer (MIT, pinned
 * in package.json): a JavaScript port of OpenAI's tiktoken encodings. Each
 * encoding's rank table is a large module, about 2 MB (o200k_base) and 1 MB
 * (cl100k_base) before compression, so it loads only when a count needs it:
 * in its own worker (tokens-o200k.worker.ts, tokens-cl100k.worker.ts), or,
 * where no worker starts, imported on the page (encoders.ts). This module
 * imports neither table, so the workers built from it each carry only their
 * own.
 */
import { abortError } from "./errors";

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

/** An encoder with the encoding it counts with. */
export interface NamedEncoder {
    id: GptEncodingId;
    encoder: GptEncoder;
}

/** Lets the page paint and take input between slices of work. */
export function nextTask(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError();
}

export interface ScanOptions {
    signal?: AbortSignal;
    /** Characters read so far; called between slices and once at the end. */
    onProgress?: (done: number, total: number) => void;
    /** How long to work between progress reports and, when yielding, turns for the page. */
    sliceMs?: number;
    /**
     * Give the page a turn between slices, so a long text neither freezes the
     * tab nor stops Cancel. Off in the token workers, which have no page to
     * keep drawing and which Cancel ends outright.
     */
    yields?: boolean;
}

/**
 * Walk the text piece by piece, as the encoder splits it before merging
 * bytes into tokens. The pieces cover the text end to end, so their lengths
 * add up to the text's and the tokens to its exact count.
 */
export async function scanPieces(
    text: string, encoder: GptEncoder,
    onPiece: (piece: string, tokens: number) => void,
    { signal, onProgress, sliceMs = 30, yields = true }: ScanOptions = {},
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
            if (yields) await nextTask();
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
