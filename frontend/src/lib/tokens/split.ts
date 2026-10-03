/**
 * Split text into chunks of at most N GPT tokens, exactly.
 *
 * The encoder first cuts text into pieces (a word with its leading space, a
 * number, a run of punctuation or of whitespace) and only then merges bytes
 * into tokens inside each piece. A chunk that starts and ends where pieces
 * do is therefore tokenized on its own exactly as it was inside the whole
 * text, so its count is the sum of its pieces' tokens. Chunks end at those
 * boundaries, preferring a line end in the second half of the chunk; a single
 * piece longer than a chunk (a long run with no spaces) is cut between
 * characters. Every chunk's count is the tokenizer's count of the chunk's
 * own text, checked when the chunk is made.
 *
 * Progress covers two passes over the text: finding where chunks end, then
 * counting each chunk on its own. Both report as they go and, on the page's
 * thread, give the page a turn between slices and stop on Cancel.
 */
import { tagged } from "./errors";
import { AS_PLAIN_TEXT, nextTask, scanPieces, throwIfAborted, type GptEncoder, type GptEncodingId, type ScanOptions } from "./gpt";

export const MIN_CHUNK_TOKENS = 10;
export const MAX_CHUNK_TOKENS = 1_000_000;
/** More rows than this would make the page itself the problem. */
export const MAX_CHUNKS = 10_000;

export interface Chunk {
    text: string;
    /** The tokenizer's count of `text` on its own. */
    tokens: number;
}

export class TooManyChunksError extends Error {
    constructor() {
        super(`That would make more than ${MAX_CHUNKS.toLocaleString("en-US")} chunks. Choose a larger chunk size.`);
        this.name = "TooManyChunksError";
        // A setting the visitor chose, as the analytics category has it.
        tagged(this, "bad_input");
    }
}

export function validChunkSize(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_CHUNK_TOKENS && value <= MAX_CHUNK_TOKENS;
}

export async function splitIntoChunks(text: string, maxTokens: number, encoder: GptEncoder, options: ScanOptions = {}): Promise<Chunk[]> {
    if (!validChunkSize(maxTokens)) throw new RangeError(`A chunk size is a whole number from ${MIN_CHUNK_TOKENS} to ${MAX_CHUNK_TOKENS.toLocaleString("en-US")} tokens.`);
    const { signal, onProgress, sliceMs = 30, yields = true } = options;
    throwIfAborted(signal);
    const count = (part: string) => encoder.countTokens(part, AS_PLAIN_TEXT);
    const spans: Array<[number, number]> = [];
    let start = 0;       // where the chunk being filled starts
    let tokens = 0;      // its tokens so far
    let offset = 0;      // where the next piece starts
    // Places the chunk could end, with its tokens up to there: the last line
    // end, and the last word boundary (whitespace on either side).
    let lineEnd: { at: number; tokens: number } | null = null;
    let wordEnd: { at: number; tokens: number } | null = null;
    let afterSpace = true;

    const close = (end: number) => {
        if (end > start) spans.push([start, end]);
        if (spans.length > MAX_CHUNKS) throw new TooManyChunksError();
        start = end;
    };

    await scanPieces(text, encoder, (piece, pieceTokens) => {
        const atWord = afterSpace || /^\s/.test(piece);
        if (pieceTokens > maxTokens) {
            // One piece is longer than a chunk: close what came before it,
            // then cut the piece between characters into chunks of its own,
            // each counted as it is. Nothing joins a chunk that starts inside
            // a piece, so every other chunk spans whole pieces.
            close(offset);
            const end = offset + piece.length;
            for (let rest = offset; rest < end;) {
                const cut = longestFit(text, rest, end, maxTokens, count);
                close(cut);
                rest = cut;
            }
            tokens = 0;
            lineEnd = wordEnd = null;
        } else {
            if (tokens + pieceTokens > maxTokens) {
                // End at a line end in the chunk's second half, else right
                // here if this is between words, else at the last word
                // boundary in its second half, else right here.
                const cut = lineEnd && lineEnd.tokens * 2 >= maxTokens ? lineEnd
                    : !atWord && wordEnd && wordEnd.tokens * 2 >= maxTokens ? wordEnd : null;
                if (cut) {
                    close(cut.at);
                    tokens -= cut.tokens;
                } else {
                    close(offset);
                    tokens = 0;
                }
                lineEnd = wordEnd = null;
                if (tokens + pieceTokens > maxTokens) {
                    close(offset);
                    tokens = 0;
                }
            }
            if (atWord && offset > start) wordEnd = { at: offset, tokens };
            tokens += pieceTokens;
        }
        offset += piece.length;
        if (piece.endsWith("\n")) lineEnd = { at: offset, tokens };
        afterSpace = /\s$/.test(piece);
    }, { signal, sliceMs, yields, onProgress: onProgress && ((done, total) => onProgress(done, total * 2)) });
    close(offset);

    // The second pass: each chunk counted on its own, its edges trimmed.
    const chunks: Chunk[] = [];
    let since = performance.now();
    for (const [from, to] of spans) {
        const raw = text.slice(from, to);
        const trimmed = raw.trim();
        if (trimmed) {
            // Trimming the edges can, rarely, change how the edge pieces merge;
            // keep the untrimmed text then, whose count fits by construction.
            const trimmedTokens = count(trimmed);
            const chunk = trimmedTokens <= maxTokens ? { text: trimmed, tokens: trimmedTokens } : { text: raw, tokens: count(raw) };
            if (chunk.tokens > maxTokens) throw new Error("A chunk came out larger than the chunk size.");
            chunks.push(chunk);
        }
        throwIfAborted(signal);
        if (performance.now() - since >= sliceMs) {
            onProgress?.(text.length + to, text.length * 2);
            if (yields) {
                await nextTask();
                throwIfAborted(signal);
            }
            since = performance.now();
        }
    }
    onProgress?.(text.length * 2, text.length * 2);
    return chunks;
}

/**
 * Where to end a chunk that starts at `from` inside one long piece: the
 * furthest character boundary, up to `end`, at which text.slice(from, cut)
 * still fits, found by halving. The search looks at most 8 characters per
 * token ahead, so a long piece costs about its own length to cut, not that
 * length for every chunk; when that much fits, the chunk ends there. At
 * least one whole character always fits: a character is at most 4 bytes, so
 * at most 4 tokens, and the smallest chunk size is 10.
 */
function longestFit(text: string, from: number, end: number, maxTokens: number, count: (part: string) => number): number {
    // A cut never falls between the two halves of a surrogate pair.
    const boundary = (at: number) => (at < end && isLowSurrogate(text.charCodeAt(at)) ? at - 1 : at);
    let fits = Math.min(end, from + (isHighSurrogate(text.charCodeAt(from)) ? 2 : 1));
    let tooLong = boundary(Math.min(end, from + maxTokens * 8));
    if (tooLong <= fits || count(text.slice(from, tooLong)) <= maxTokens) return Math.max(fits, tooLong);
    while (tooLong - fits > 1) {
        const middle = boundary(Math.floor((fits + tooLong) / 2));
        if (middle <= fits) break;
        if (count(text.slice(from, middle)) <= maxTokens) fits = middle; else tooLong = middle;
    }
    return fits;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** A chunk's first words, on one line, for the list on the page. */
export function chunkPreview(text: string, limit = 80): string {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= limit) return flat;
    const cut = flat.slice(0, limit);
    const space = cut.lastIndexOf(" ");
    return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const n = (value: number) => value.toLocaleString("en-US");

/** Every chunk in one text file, each under a line that names it. */
export function chunksAsText(chunks: readonly Chunk[], { encoding, maxTokens }: { encoding: GptEncodingId; maxTokens: number }): string {
    const lines = [`Split into ${n(chunks.length)} chunk${chunks.length === 1 ? "" : "s"} of at most ${n(maxTokens)} tokens each, counted with ${encoding}.`, ""];
    chunks.forEach((chunk, index) => {
        lines.push(`===== Chunk ${n(index + 1)} of ${n(chunks.length)} · ${n(chunk.tokens)} token${chunk.tokens === 1 ? "" : "s"} =====`, chunk.text, "");
    });
    return lines.join("\n");
}
