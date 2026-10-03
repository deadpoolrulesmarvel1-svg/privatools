/**
 * Splitting extracted PDF text into translatable chunks.
 *
 * OPUS-MT models have a hard input limit (512 tokens). Feeding a whole page in
 * doesn't error — it silently truncates, so the back half of the page just
 * quietly fails to appear in the output. Chunking is therefore correctness, not
 * an optimisation.
 *
 * Split on sentence boundaries wherever possible: a sentence cut in half
 * translates badly in both halves, because the model loses the grammatical
 * context it needs to pick agreement and word order.
 */

import { breakOffsets, NO_SPACE_SCRIPT } from "@/lib/subtitles/captions";

/** Conservative: ~4 characters per token, well inside the 512-token limit. */
export const DEFAULT_MAX_CHARS = 900;

/** Sentence-ending punctuation across the scripts the model list covers. */
const SENTENCE_BOUNDARY = /(?<=[.!?。！？；;])\s*/g;

export function splitSentences(text: string): string[] {
    return text
        .split(SENTENCE_BOUNDARY)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Hard-split a single sentence that is itself over the limit.
 * Prefers a space near the limit so words survive intact.
 */
function splitOversized(sentence: string, maxChars: number): string[] {
    const parts: string[] = [];
    let rest = sentence;
    while (rest.length > maxChars) {
        const window = rest.slice(0, maxChars);
        const breakAt = window.lastIndexOf(" ");
        // No space at all (CJK, or a pathological token) — cut at the limit.
        const cut = breakAt > maxChars * 0.5 ? breakAt : maxChars;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
}

/* ── By the model's own tokens ───────────────────────────────────────── */


/** Two pieces of text as one: with a space, unless both sides are a script written without spaces. */
export function joinWords(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    const last = Array.from(a.trimEnd()).pop() ?? "";
    const first = Array.from(b.trimStart())[0] ?? "";
    const tight = NO_SPACE_SCRIPT.test(last) && (NO_SPACE_SCRIPT.test(first) || /^[、。，！？」』）]/.test(first))
        || /[。！？]$/.test(last) && NO_SPACE_SCRIPT.test(first);
    return tight ? a.trimEnd() + b.trimStart() : `${a.trimEnd()} ${b.trimStart()}`;
}

/**
 * A sentence longer than the limit, cut at word breaks (Intl.Segmenter's
 * words where there are no spaces). Pieces are slices of the sentence, so
 * its own spacing, such as the spaces between Thai phrases, is kept.
 */
function splitByTokens(sentence: string, countTokens: (text: string) => number, maxTokens: number): string[] {
    const cuts = [...breakOffsets(sentence).filter(offset => offset > 0 && offset < sentence.length), sentence.length];
    const parts: string[] = [];
    let start = 0;
    let fits = 0;
    for (const cut of cuts) {
        if (fits > start && countTokens(sentence.slice(start, cut).trim()) > maxTokens) {
            parts.push(sentence.slice(start, fits).trim());
            start = fits;
        }
        fits = cut;
    }
    if (start < sentence.length) parts.push(sentence.slice(start).trim());
    // A single "word" over the limit (a long run of one script with no break) is cut by characters.
    return parts.flatMap(part => {
        if (countTokens(part) <= maxTokens) return [part];
        const pieces: string[] = [];
        const chars = Array.from(part);
        let piece = "";
        for (const ch of chars) {
            if (piece && countTokens(piece + ch) > maxTokens) { pieces.push(piece); piece = ""; }
            piece += ch;
        }
        if (piece) pieces.push(piece);
        return pieces;
    });
}

/**
 * Text in pieces of at most `maxTokens` of the model's own tokens, whole
 * sentences where they fit. Counting characters instead cut Chinese, Japanese,
 * Korean and Thai silently: 900 of their characters are far more than the
 * 512 tokens OPUS-MT reads, and it drops the rest without an error.
 */
export function chunkByTokens(text: string, countTokens: (text: string) => number, maxTokens: number): string[] {
    const normalised = text.replace(/\s+/g, " ").trim();
    if (!normalised) return [];
    if (countTokens(normalised) <= maxTokens) return [normalised];
    const chunks: string[] = [];
    let current = "";
    for (const sentence of splitSentences(normalised)) {
        if (countTokens(sentence) > maxTokens) {
            if (current) { chunks.push(current); current = ""; }
            chunks.push(...splitByTokens(sentence, countTokens, maxTokens));
            continue;
        }
        const candidate = joinWords(current, sentence);
        if (current && countTokens(candidate) > maxTokens) {
            chunks.push(current);
            current = sentence;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/* ── By characters ───────────────────────────────────────────────────── */

export function chunkForTranslation(
    text: string,
    maxChars: number = DEFAULT_MAX_CHARS,
): string[] {
    const normalised = text.replace(/\s+/g, " ").trim();
    if (!normalised) return [];
    if (normalised.length <= maxChars) return [normalised];

    const chunks: string[] = [];
    let current = "";

    for (const sentence of splitSentences(normalised)) {
        if (sentence.length > maxChars) {
            if (current) { chunks.push(current); current = ""; }
            chunks.push(...splitOversized(sentence, maxChars));
            continue;
        }
        const candidate = current ? `${current} ${sentence}` : sentence;
        if (candidate.length > maxChars) {
            if (current) chunks.push(current);
            current = sentence;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}
