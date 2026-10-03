/**
 * A guard against the one kind of text that makes the GPT tokenizer slow.
 *
 * The tokenizer first cuts text into pieces (a word, up to three digits, a
 * run of punctuation or of whitespace), then merges each piece's bytes into
 * tokens. gpt-tokenizer makes a pass over the whole piece for every merge, so
 * a piece's time grows with the square of its length: words cost nothing,
 * but one unbroken run of 60,000 Chinese characters took 68 seconds in
 * Chromium on the dev VM, and each doubling makes a run four times slower.
 *
 * So, before anything is counted, no run of these kinds may be longer than
 * MAX_RUN_CHARS characters:
 * - letters and combining marks, which make a word;
 * - characters that are neither whitespace, letters nor digits, which make
 *   punctuation (marks too: cl100k_base puts them there);
 * - whitespace;
 * - line breaks and slashes, which o200k_base adds to a punctuation piece.
 * A piece spans at most two such runs and a few characters more, so the
 * guard holds every piece to about twice the limit. A run of 20,000
 * characters costs at most about 5 seconds per encoding in Node on the dev
 * VM: emoji, the slowest, at 4 bytes each; Chinese about 3; English letters,
 * punctuation and spaces under half a second.
 */
import { ReadError } from "./errors";

export const MAX_RUN_CHARS = 20_000;

export type RunKind = "letters" | "symbols" | "spaces" | "breaks";

export interface LongRun {
    kind: RunKind;
    /** Where the run starts, as a string index. */
    start: number;
    /** Its length in characters (code points, so an emoji is one). */
    length: number;
}

const LETTER = 1, SYMBOL = 2, SPACE = 4, BREAK = 8, KNOWN = 16;
const IS_LETTER = /\p{L}/u, IS_MARK = /\p{M}/u, IS_NUMBER = /\p{N}/u, IS_SPACE = /\s/u;

/** Each character's kinds, worked out once per character and kept. */
const bmp = new Uint8Array(0x10000);
const astral = new Map<number, number>();

function classify(code: number): number {
    const char = String.fromCodePoint(code);
    const letter = IS_LETTER.test(char), mark = IS_MARK.test(char), space = IS_SPACE.test(char);
    let bits = KNOWN;
    if (letter || mark) bits |= LETTER;
    if (!space && !letter && !IS_NUMBER.test(char)) bits |= SYMBOL;
    if (space) bits |= SPACE;
    if (code === 0x0a || code === 0x0d || code === 0x2f) bits |= BREAK;
    return bits;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The kinds of the character at `i`, and how many string units it takes. */
function at(text: string, i: number): [bits: number, width: number] {
    const code = text.charCodeAt(i);
    if (isHigh(code) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
        const point = ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00) + 0x10000;
        let bits = astral.get(point);
        if (bits === undefined) astral.set(point, bits = classify(point));
        return [bits, 2];
    }
    return [bmp[code] || (bmp[code] = classify(code)), 1];
}

/** The first run longer than `limit` characters, measured to its end; null when there is none. */
export function findLongRun(text: string, limit = MAX_RUN_CHARS): LongRun | null {
    // A run of more than `limit` characters takes more than `limit` string units.
    if (text.length <= limit) return null;
    let letters = 0, symbols = 0, spaces = 0, breaks = 0;
    let lettersFrom = 0, symbolsFrom = 0, spacesFrom = 0, breaksFrom = 0;
    for (let i = 0; i < text.length;) {
        // The common case inline: one string unit that is not half of a pair.
        let bits: number, width: number;
        const code = text.charCodeAt(i);
        if (isHigh(code)) [bits, width] = at(text, i);
        else { bits = bmp[code] || (bmp[code] = classify(code)); width = 1; }
        if (bits & LETTER) { if (letters++ === 0) lettersFrom = i; } else letters = 0;
        if (bits & SYMBOL) { if (symbols++ === 0) symbolsFrom = i; } else symbols = 0;
        if (bits & SPACE) { if (spaces++ === 0) spacesFrom = i; } else spaces = 0;
        if (bits & BREAK) { if (breaks++ === 0) breaksFrom = i; } else breaks = 0;
        i += width;
        if (letters > limit) return measure(text, "letters", LETTER, lettersFrom);
        if (symbols > limit) return measure(text, "symbols", SYMBOL, symbolsFrom);
        if (spaces > limit) return measure(text, "spaces", SPACE, spacesFrom);
        if (breaks > limit) return measure(text, "breaks", BREAK, breaksFrom);
    }
    return null;
}

function measure(text: string, kind: RunKind, bit: number, start: number): LongRun {
    let length = 0;
    for (let i = start; i < text.length;) {
        const [bits, width] = at(text, i);
        if (!(bits & bit)) break;
        length++;
        i += width;
    }
    return { kind, start, length };
}

const n = (value: number) => value.toLocaleString("en-US");

/** The run's first characters, to find it by. */
function opening(text: string, start: number): string {
    return Array.from(text.slice(start, start + 32)).slice(0, 16).join("");
}

export function longRunMessage(run: LongRun, text: string): string {
    const what = {
        letters: `This text has ${n(run.length)} letters in a row with no space, digit or punctuation between them, starting “${opening(text, run.start)}…”.`,
        symbols: `This text has ${n(run.length)} punctuation marks or symbols in a row with no space between them, starting “${opening(text, run.start)}…”.`,
        spaces: `This text has ${n(run.length)} spaces, tabs or line breaks in a row.`,
        breaks: `This text has ${n(run.length)} slashes and line breaks in a row.`,
    }[run.kind];
    const fix = run.kind === "spaces" ? "Remove the extra spaces and line breaks, or count a shorter part." : "Break it up with spaces or line breaks, or count a shorter part.";
    return `${what} The GPT tokenizer slows down sharply on runs that long (doubling a run makes it four times slower), so this page counts runs of up to ${n(MAX_RUN_CHARS)} characters. ${fix}`;
}

/** Refuses text with a run the tokenizer would take too long over, saying where it starts. */
export function checkRuns(text: string): void {
    const run = findLongRun(text);
    if (run) throw new ReadError("long-run", longRunMessage(run, text));
}
