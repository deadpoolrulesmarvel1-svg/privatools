/**
 * Caption cues from recognised speech.
 *
 * Whisper returns segments of a sentence or two with their start and end
 * times. A subtitle cue has to be readable at a glance, so each segment is cut
 * into cues of at most two lines (or one, by choice) of a set length, ending
 * where a sentence or clause ends when that leaves both parts a sensible
 * size, and the segment's time is shared out in proportion to the text each
 * cue carries. No cue stays on screen longer than seven seconds or shorter
 * than it takes to read a word, and cues never overlap.
 *
 * Scripts written without spaces between words (Chinese, Japanese, Thai and
 * others) are broken between words found by Intl.Segmenter, on shorter lines.
 */
import type { SpeechSegment } from "@/lib/speechTranscript";

export interface CaptionLayout {
    /** Characters a line may hold. */
    maxLineChars: number;
    /** Lines a cue may hold: 1 or 2. */
    maxLines: number;
}

export type CaptionStyle = "two" | "one" | "short";

/** How long a cue may stay on screen, in seconds. Seven is the usual broadcast and streaming ceiling. */
export const CAPTION_TIMING = { maxSeconds: 7, minSeconds: 0.8 } as const;

/** Languages written in full-width characters, which take about half the line length. */
const FULL_WIDTH_LANGUAGES = new Set(["zh", "ja", "ko", "yue"]);

/**
 * Line length and count for a caption style: two lines of 42 characters (the
 * common limit for Latin scripts), one line of 42, or one short line for
 * vertical video. Full-width scripts get 16 characters a line.
 */
export function layoutFor(language: string, style: CaptionStyle): CaptionLayout {
    const fullWidth = FULL_WIDTH_LANGUAGES.has(language);
    if (style === "short") return { maxLineChars: fullWidth ? 10 : 24, maxLines: 1 };
    return { maxLineChars: fullWidth ? 16 : 42, maxLines: style === "one" ? 1 : 2 };
}

// Characters of scripts written without spaces between words.
const NO_SPACE_SCRIPT = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
// What may not begin a line: closing punctuation, and the Japanese marks that belong to the word before.
const CLOSING = /^[.,!?;:%…)\]}»”’"'。、，．！？；：」』）】〕〉》ーゝゞヽヾ々〜]/;
const SENTENCE_END = /[.!?…。！？]["'”’»」』)）]*$/;
const CLAUSE_END = /[,;:—–、，；：]["'”’»」』)）]*$/;

interface Atom { text: string; space: boolean; noSpace: boolean }

const chars = (text: string) => Array.from(text).length;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** Words and the spaces between them; in scripts without spaces, the words Intl.Segmenter finds. */
function atomize(text: string): Atom[] {
    const atoms: Atom[] = [];
    const add = (part: string) => { if (part) atoms.push({ text: part, space: /^\s+$/.test(part), noSpace: NO_SPACE_SCRIPT.test(part) }); };
    if (!NO_SPACE_SCRIPT.test(text)) {
        for (const part of text.split(/(\s+)/)) add(part);
        return atoms;
    }
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
    if (Segmenter) for (const { segment } of new Segmenter(undefined, { granularity: "word" }).segment(text)) add(segment);
    else for (const character of Array.from(text)) add(character);
    return atoms;
}

/** Whether a line may break before atom `i`: at a space, or between words of a script without spaces, never before closing punctuation. */
function canBreakBefore(atoms: Atom[], i: number): boolean {
    if (i <= 0 || i >= atoms.length) return false;
    const before = atoms[i - 1];
    const at = atoms[i];
    if (at.space) return !CLOSING.test(atoms[i + 1]?.text ?? "");
    if (CLOSING.test(at.text)) return false;
    return before.space || before.noSpace || at.noSpace;
}

const join = (atoms: Atom[], from: number, to: number) => atoms.slice(from, to).map(atom => atom.text).join("").trim();

/** A line fits when it is short enough, or when it is one word no line could hold. */
function lineFits(atoms: Atom[], from: number, to: number, max: number): boolean {
    const text = join(atoms, from, to);
    if (!text) return false;
    if (chars(text) <= max) return true;
    return atoms.slice(from, to).filter(atom => !atom.space).length === 1;
}

function wrapAtoms(atoms: Atom[], layout: CaptionLayout): string[] | null {
    if (!atoms.some(atom => !atom.space)) return [];
    if (lineFits(atoms, 0, atoms.length, layout.maxLineChars)) return [join(atoms, 0, atoms.length)];
    if (layout.maxLines < 2) return null;
    let best: { lines: string[]; score: number } | null = null;
    for (let at = 1; at < atoms.length; at++) {
        if (!canBreakBefore(atoms, at)) continue;
        if (!lineFits(atoms, 0, at, layout.maxLineChars) || !lineFits(atoms, at, atoms.length, layout.maxLineChars)) continue;
        const top = join(atoms, 0, at);
        const bottom = join(atoms, at, atoms.length);
        // As even as possible; a break after punctuation is worth a few characters of evenness; on a tie, the longer line goes below.
        const score = Math.max(chars(top), chars(bottom)) - (SENTENCE_END.test(top) || CLAUSE_END.test(top) ? 4 : 0) + (chars(top) > chars(bottom) ? 0.5 : 0);
        if (!best || score < best.score) best = { lines: [top, bottom], score };
    }
    return best?.lines ?? null;
}

/**
 * The caption's text in at most `layout.maxLines` lines of at most
 * `layout.maxLineChars` characters, broken as evenly as the words allow, or
 * null when it cannot fit. A single word longer than a line (an address) gets
 * a line to itself rather than being broken.
 */
export function wrapCaption(text: string, layout: CaptionLayout): string[] | null {
    return wrapAtoms(atomize(tidy(text)), layout);
}

/** Where to end the cue that starts at atom `from`. */
function cueEnd(atoms: Atom[], from: number, layout: CaptionLayout): number {
    const capacity = layout.maxLineChars * layout.maxLines;
    const fits = (a: number, b: number) => wrapAtoms(atoms.slice(a, b), layout) !== null;
    const length = (a: number, b: number) => chars(join(atoms, a, b));
    const fitting: number[] = [];
    for (let at = from + 1; at <= atoms.length; at++) {
        if (at < atoms.length && !canBreakBefore(atoms, at)) continue;
        if (!fits(from, at)) {
            if (!fitting.length) fitting.push(at);
            break;
        }
        fitting.push(at);
    }
    const last = fitting[fitting.length - 1];
    if (last >= atoms.length) return atoms.length;
    const endsWith = (pattern: RegExp) => (at: number) => pattern.test(join(atoms, from, at));
    const evenest = (candidates: number[]) => candidates.reduce((best, at) =>
        Math.min(length(from, at), length(at, atoms.length)) > Math.min(length(from, best), length(best, atoms.length)) ? at : best);
    if (fits(last, atoms.length)) {
        // What is left fits in one more cue: split the text in two, at a sentence or clause end if both parts are a fair size.
        const pairs = fitting.filter(at => fits(at, atoms.length));
        const fair = Math.max(4, Math.round(capacity * 0.15));
        const sized = (at: number) => length(from, at) >= fair && length(at, atoms.length) >= fair;
        const atSentence = pairs.filter(at => endsWith(SENTENCE_END)(at) && sized(at));
        if (atSentence.length) return evenest(atSentence);
        const atClause = pairs.filter(at => endsWith(CLAUSE_END)(at) && sized(at));
        if (atClause.length) return evenest(atClause);
        return evenest(pairs);
    }
    // More than two cues remain: fill this one, ending at a sentence or clause near its end.
    const atSentence = fitting.filter(at => endsWith(SENTENCE_END)(at) && length(from, at) >= capacity * 0.4);
    if (atSentence.length) return atSentence[atSentence.length - 1];
    const atClause = fitting.filter(at => endsWith(CLAUSE_END)(at) && length(from, at) >= capacity * 0.6);
    if (atClause.length) return atClause[atClause.length - 1];
    return last;
}

/** A segment's text as the cues it needs, each fitting the layout. */
function splitText(text: string, layout: CaptionLayout): string[] {
    const atoms = atomize(text);
    const pieces: string[] = [];
    let from = 0;
    while (from < atoms.length) {
        while (from < atoms.length && atoms[from].space) from++;
        if (from >= atoms.length) break;
        const to = cueEnd(atoms, from, layout);
        pieces.push(join(atoms, from, to));
        from = to;
    }
    return pieces;
}

/** Share [start, end] among texts in proportion to their length. */
function shareTime(texts: string[], start: number, end: number): SpeechSegment[] {
    const weights = texts.map(chars);
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let at = start;
    let used = 0;
    return texts.map((text, index) => {
        used += weights[index];
        const until = index === texts.length - 1 ? end : start + (end - start) * (used / total);
        const cue = { start: at, end: until, text };
        at = until;
        return cue;
    });
}

/** The text in two parts, broken at the break nearest its middle, or null when it has no break. */
function halve(text: string): [string, string] | null {
    const atoms = atomize(text);
    const middle = chars(text) / 2;
    let best: { at: number; distance: number } | null = null;
    for (let at = 1; at < atoms.length; at++) {
        if (!canBreakBefore(atoms, at)) continue;
        const distance = Math.abs(chars(join(atoms, 0, at)) - middle);
        if (!best || distance < best.distance) best = { at, distance };
    }
    if (!best) return null;
    const first = join(atoms, 0, best.at);
    const second = join(atoms, best.at, atoms.length);
    return first && second ? [first, second] : null;
}

/** A cue longer than the ceiling: two cues if it holds more than a line of text, otherwise the same cue, cut short. */
function limitDuration(cue: SpeechSegment, layout: CaptionLayout): SpeechSegment[] {
    if (cue.end - cue.start <= CAPTION_TIMING.maxSeconds) return [cue];
    const halves = chars(cue.text) > layout.maxLineChars ? halve(cue.text) : null;
    if (halves) return shareTime(halves, cue.start, cue.end).flatMap(part => limitDuration(part, layout));
    return [{ ...cue, end: cue.start + CAPTION_TIMING.maxSeconds }];
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** In time order, never overlapping, each up long enough to read, none outside the audio, times to the millisecond. */
function settle(cues: SpeechSegment[], totalSeconds?: number): SpeechSegment[] {
    const end = totalSeconds ?? Number.POSITIVE_INFINITY;
    const sorted = cues.map(cue => ({ ...cue })).sort((a, b) => a.start - b.start || a.end - b.end);
    sorted.forEach((cue, index) => {
        cue.start = Math.min(Math.max(0, cue.start), end);
        cue.end = Math.min(Math.max(cue.end, cue.start), end);
        const previous = sorted[index - 1];
        if (previous && previous.end > cue.start) previous.end = Math.max(previous.start, cue.start);
    });
    sorted.forEach((cue, index) => {
        if (cue.end - cue.start >= CAPTION_TIMING.minSeconds) return;
        const limit = Math.min(sorted[index + 1]?.start ?? Number.POSITIVE_INFINITY, end);
        cue.end = Math.max(cue.end, Math.min(cue.start + CAPTION_TIMING.minSeconds, limit));
    });
    sorted.forEach((cue, index) => {
        if (cue.end - cue.start >= 0.05) return;
        // No time of its own (it starts where the next does): share the next cue's time by text length.
        const next = sorted[index + 1];
        if (next && next.end > cue.start) {
            const split = cue.start + (next.end - cue.start) * (chars(cue.text) / (chars(cue.text) + chars(next.text)));
            cue.end = split;
            next.start = Math.max(next.start, split);
        } else {
            cue.end = Math.min(cue.start + CAPTION_TIMING.minSeconds, Math.max(end, cue.start + 0.05));
        }
    });
    return sorted.map(cue => {
        const start = round(cue.start);
        return { start, end: Math.max(round(cue.end), start + 0.001), text: cue.text };
    });
}

/**
 * Cues from recognised segments, laid out for `layout`. `totalSeconds`, the
 * length of the audio, keeps the last cue from running past it.
 */
export function buildCues(segments: readonly SpeechSegment[], layout: CaptionLayout, totalSeconds?: number): SpeechSegment[] {
    const cues: SpeechSegment[] = [];
    for (const segment of segments) {
        const text = tidy(segment.text);
        if (!text) continue;
        const start = Number.isFinite(segment.start) ? segment.start : 0;
        const end = Number.isFinite(segment.end) ? Math.max(segment.end, start) : start;
        for (const piece of shareTime(splitText(text, layout), start, end).flatMap(cue => limitDuration(cue, layout))) {
            cues.push({ ...piece, text: (wrapCaption(piece.text, layout) ?? [piece.text]).join("\n") });
        }
    }
    return settle(cues, totalSeconds);
}
