/**
 * Subtitle cues are usually fragments of sentences, and a translation model
 * given a fragment alone guesses: OPUS-MT turned "and bought some milk." into
 * the third person, which "I went to the store" before it rules out, and it
 * can invent a whole sentence for a two-letter fragment. So consecutive cues
 * are translated together, as the sentence or short passage they form, and
 * the translation is then shared out across the same cues.
 *
 * Grouping: a passage ends where a sentence does, where a new speaker starts
 * (a dialogue dash, a voice span, a speaker's label), where the styling
 * changes (italics for a voice off screen), after a long pause, and at five
 * cues or a few hundred characters, which unpunctuated captions need.
 *
 * Sharing out: each cue gets the share of the translation that its source
 * text had of the passage, by characters, ending at a word break. A break
 * just after punctuation of the kind that ended the cue's source is
 * preferred when it is close: subtitlers end cues at clause boundaries, and
 * translations keep the comma or full stop there. A sentence in one cue stays
 * in its cue whole.
 */
import { breakOffsets } from "./captions";

export interface PassagePart {
    /** The words to translate. */
    text: string;
    /** Starts a new speaker's turn. */
    turn: boolean;
    /** The tags wrapping the words, such as "i". */
    style: string;
    /** The cue it belongs to, and that cue's times in seconds. */
    cue: number;
    start: number;
    end: number;
}

export const PASSAGE_LIMITS = { maxParts: 5, maxChars: 320, maxGapSeconds: 3 } as const;

const CLOSERS = `["'”’»」』)）\\]]*`;
const SENTENCE_END = new RegExp(`[.!?…。！？؟۔।॥]${CLOSERS}$`);
const CLAUSE_END = new RegExp(`[,;:—–、，；：،؛]${CLOSERS}$`);
/** A next cue that starts with an ellipsis or a small letter carries on the same sentence. */
const CARRIES_ON = /^(?:\.\.\.|…|\p{Ll})/u;

/** Whether a part ends its sentence, given the part that follows it. */
export function endsSentence(text: string, next?: string): boolean {
    if (!SENTENCE_END.test(text.trim())) return false;
    return next === undefined || !CARRIES_ON.test(next.trimStart());
}

/** The parts, by index, grouped into passages in order. */
export function groupPassages(parts: readonly PassagePart[], limits: { maxParts: number; maxChars: number; maxGapSeconds: number } = PASSAGE_LIMITS): number[][] {
    const passages: number[][] = [];
    let current: number[] = [];
    let chars = 0;
    parts.forEach((part, index) => {
        if (current.length) {
            const previous = parts[current[current.length - 1]];
            const ends = endsSentence(previous.text, part.text)
                || part.turn
                || previous.cue === part.cue
                || previous.style !== part.style
                || part.start - previous.end > limits.maxGapSeconds
                || current.length >= limits.maxParts
                || chars + part.text.length > limits.maxChars;
            if (ends) {
                passages.push(current);
                current = [];
                chars = 0;
            }
        }
        current.push(index);
        chars += part.text.length;
    });
    if (current.length) passages.push(current);
    return passages;
}

const chars = (text: string) => Array.from(text).length;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** How strongly a break after this punctuation is preferred, given how the source cue ended. */
function preference(before: string, source: string): number {
    const ended = SENTENCE_END.test(source.trim()) ? "sentence" : CLAUSE_END.test(source.trim()) ? "clause" : null;
    if (SENTENCE_END.test(before)) return ended === "sentence" ? 0.2 : 0.08;
    if (CLAUSE_END.test(before)) return ended === "clause" ? 0.12 : ended === "sentence" ? 0.06 : 0.04;
    return 0;
}

export interface Shares {
    /** The translation's piece for each part, in order. */
    pieces: string[];
    /** Parts that repeat the piece before them, because the translation had fewer words than there were cues to fill. */
    repeated: boolean[];
}

/**
 * A passage's translation shared out among its parts, in proportion to their
 * source text, at word breaks, with the punctuation preference above. Each
 * part gets at least one word; when the translation has fewer words than
 * there are parts, the last parts repeat the piece before them, so no cue is
 * left empty and none is moved.
 */
export function distribute(translation: string, sources: readonly string[]): Shares {
    const text = tidy(translation);
    const count = sources.length;
    if (count <= 1) return { pieces: [text], repeated: [false] };
    const breaks = breakOffsets(text).filter(offset => offset > 0 && offset < text.length);
    if (breaks.length < count - 1) {
        // Fewer words than parts: one word each from the start, the rest held.
        const cuts = [0, ...breaks, text.length];
        const pieces: string[] = [];
        const repeated: boolean[] = [];
        for (let i = 0; i < count; i++) {
            if (i < cuts.length - 1) { pieces.push(text.slice(cuts[i], cuts[i + 1]).trim()); repeated.push(false); }
            else { pieces.push(pieces[pieces.length - 1]); repeated.push(true); }
        }
        return { pieces, repeated };
    }
    const weights = sources.map(source => Math.max(1, chars(tidy(source))));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const length = text.length;
    const targets: number[] = [];
    let running = 0;
    for (let i = 0; i < count - 1; i++) {
        running += weights[i];
        targets.push((length * running) / total);
    }
    const cost = (split: number, offset: number) =>
        Math.abs(offset - targets[split]) / length - preference(text.slice(0, offset).trimEnd(), sources[split]);
    // best[s][j]: the least cost of the first s + 1 breaks, the last at breaks[j].
    const best: number[][] = [];
    const from: number[][] = [];
    for (let s = 0; s < count - 1; s++) {
        best.push([]);
        from.push([]);
        for (let j = 0; j < breaks.length; j++) {
            if (j < s || breaks.length - j < count - 1 - s) { best[s].push(Infinity); from[s].push(-1); continue; }
            let previous = 0;
            let previousAt = -1;
            if (s > 0) {
                previous = Infinity;
                for (let p = 0; p < j; p++) if (best[s - 1][p] < previous) { previous = best[s - 1][p]; previousAt = p; }
            }
            best[s].push(previous + cost(s, breaks[j]));
            from[s].push(previousAt);
        }
    }
    let at = 0;
    for (let j = 1; j < breaks.length; j++) if (best[count - 2][j] < best[count - 2][at]) at = j;
    const chosen: number[] = [];
    for (let s = count - 2; s >= 0; s--) {
        chosen.unshift(breaks[at]);
        at = from[s][at];
    }
    const cuts = [0, ...chosen, length];
    return {
        pieces: cuts.slice(0, -1).map((cut, i) => text.slice(cut, cuts[i + 1]).trim()),
        repeated: sources.map(() => false),
    };
}
