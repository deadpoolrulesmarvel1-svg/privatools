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
