/**
 * SubRip (.srt) and WebVTT (.vtt) files, read and written so that nothing a
 * translation does not touch changes: every cue keeps its number or
 * identifier and its timing line exactly as written, VTT keeps its header,
 * its cue settings and its NOTE, STYLE and REGION blocks, and a file is
 * written back with its own line endings and byte-order mark. Saving in the
 * other format writes what that format can hold and counts what it can't.
 *
 * Reading is strict about the one thing a translation must not guess, the
 * timing: a timing line that can't be read stops the file with its line
 * number. Other slips common in the wild are taken as meant: a missing blank
 * line between cues, a blank line inside a cue's text, a dot for the comma.
 */
import { convertCueMarkup } from "./cueText";

export type SubtitleFormat = "srt" | "vtt";
export type SubtitleEncoding = "UTF-8" | "UTF-16LE" | "UTF-16BE";

/** Larger than any single film or lecture's subtitles (a three-hour film is about 2,500 cues and 200 KB). */
export const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
export const MAX_SUBTITLE_BYTES_LABEL = "4 MB";
export const MAX_SUBTITLE_CUES = 10_000;

export interface SubtitleCue {
    kind: "cue";
    /** The SRT number or the VTT cue identifier, as written; undefined when the cue has none. */
    id?: string;
    /** The timing line as written, for a file saved in the same format. */
    timing: string;
    /** Seconds. */
    start: number;
    end: number;
    /** What follows the end time: VTT cue settings, or SRT's old position coordinates. */
    settings: string;
    /** The cue's text lines, as written. */
    lines: string[];
    /** The timing line's line number in the file, counting from 1. */
    line: number;
}

/** A VTT comment, style sheet or region definition, kept as written. */
export interface SubtitleBlock {
    kind: "note" | "style" | "region";
    lines: string[];
}

export interface SubtitleDocument {
    format: SubtitleFormat;
    encoding: SubtitleEncoding;
    bom: boolean;
    newline: "\n" | "\r\n";
    /** VTT: the WEBVTT line and any header lines after it. Empty for SRT. */
    header: string[];
    blocks: (SubtitleCue | SubtitleBlock)[];
    /** Line breaks after the last block, kept so a file round-trips. */
    trailingNewlines: number;
}

export type SubtitleProblem =
    | "empty" | "binary" | "encoding" | "too-large" | "too-many-cues"
    | "ass" | "not-subtitles" | "no-cues" | "bad-timing" | "no-timing";

/** Why a file can't be translated, worded for the visitor: a heading and what to do. */
export class SubtitleFileError extends Error {
    readonly problem: SubtitleProblem;
    readonly title: string;
    readonly detail: string;
    /** The line the problem is on, counting from 1. */
    readonly line?: number;
    /** The analytics category toolErrorKind reads (lib/toolRun.ts). */
    readonly __kind: "bad_input" | "too_large";

    constructor(problem: SubtitleProblem, title: string, detail: string, line?: number) {
        super(`${title} ${detail}`);
        this.name = "SubtitleFileError";
        this.problem = problem;
        this.title = title;
        this.detail = detail;
        this.line = line;
        this.__kind = problem === "too-large" || problem === "too-many-cues" ? "too_large" : "bad_input";
    }
}

export const isCue = (block: SubtitleCue | SubtitleBlock): block is SubtitleCue => block.kind === "cue";

export function cuesOf(doc: SubtitleDocument): SubtitleCue[] {
    return doc.blocks.filter(isCue);
}

/* ── Bytes to text ───────────────────────────────────────────────────── */

/**
 * Two bytes in every character of mostly-Latin text, one of them zero: the
 * shape of UTF-16 written without a byte-order mark. Read from the first few
 * thousand bytes; the zeros sit at odd offsets for little-endian.
 */
function utf16WithoutBom(bytes: Uint8Array): SubtitleEncoding | null {
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096) & ~1);
    if (sample.length < 4) return null;
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < sample.length; i += 2) {
        if (sample[i] === 0) evenZeros++;
        if (sample[i + 1] === 0) oddZeros++;
    }
    const pairs = sample.length / 2;
    if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return "UTF-16LE";
    if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return "UTF-16BE";
    return null;
}

/** Control characters no subtitle text holds, a sign of a binary file; tab, line breaks and form feed are text. */
function binaryControls(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 32 && (code < 9 || code > 13)) count++;
    }
    return count;
}

/**
 * The file's text: UTF-8, with or without a byte-order mark, or UTF-16 in
 * either byte order, with a mark or recognised without one. Anything else is
 * refused rather than guessed: a guess at an older encoding would hand the
 * translator the wrong letters.
 */
export function decodeSubtitleBytes(bytes: Uint8Array, name = "This file"): { text: string; encoding: SubtitleEncoding; bom: boolean } {
    if (bytes.length === 0) throw new SubtitleFileError("empty", `${name} is empty.`, "There are no subtitles in it to translate.");
    let encoding: SubtitleEncoding = "UTF-8";
    let bom = false;
    let body = bytes;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bom = true; body = bytes.subarray(3); }
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "UTF-16LE"; bom = true; body = bytes.subarray(2); }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "UTF-16BE"; bom = true; body = bytes.subarray(2); }
    else encoding = utf16WithoutBom(bytes) ?? "UTF-8";

    if (encoding === "UTF-8" && body.subarray(0, 65536).includes(0)) {
        throw new SubtitleFileError("binary", `${name} isn’t a text file.`, "Subtitle files are plain text. Choose an .srt or .vtt file.");
    }
    let text: string;
    try {
        text = new TextDecoder(encoding.toLowerCase(), { fatal: true }).decode(body);
    } catch {
        if (encoding !== "UTF-8") {
            throw new SubtitleFileError("encoding", `${name} can’t be read as UTF-16 text.`, "Its bytes break off in the middle of a character. Open it in a text editor, save it with UTF-8 encoding, and choose it again.");
        }
        throw new SubtitleFileError("encoding", `${name} isn’t saved as UTF-8 or UTF-16.`,
            "Its letters can’t be read reliably, so nothing was translated. Open it in a text editor, save it with UTF-8 encoding (in Notepad: Save as, then Encoding: UTF-8), and choose it again.");
    }
    if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); bom = true; }
    const controls = binaryControls(text.slice(0, 65536));
    if (controls > 0 && controls > Math.min(text.length, 65536) / 1000) {
        throw new SubtitleFileError("binary", `${name} isn’t a text file.`, "Subtitle files are plain text. Choose an .srt or .vtt file.");
    }
    return { text, encoding, bom };
}

/* ── Timing ──────────────────────────────────────────────────────────── */

/** [hours:]minutes:seconds[.,fraction], minutes and seconds below 60. Every repeat is bounded, so no line can make it backtrack for long. */
const TIME = String.raw`(?:(\d{1,4}):)?([0-5]?\d):([0-5]?\d)(?:[.,](\d{1,3}))?`;
const TIMING = new RegExp(String.raw`^[ \t]*${TIME}[ \t]*-->[ \t]*${TIME}(?:[ \t]+([^\r\n]*))?$`);
/** Something meant as a time, such as 00:01:02,500 or 01:02.500. */
const LOOKS_LIKE_TIME = /\d:\d{2}[:.,]\d/;
const NUMBER_LINE = /^\s*\d+\s*$/;

function seconds(hours: string | undefined, minutes: string, secs: string, fraction: string | undefined): number {
    return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + (fraction ? Number(`0.${fraction}`) : 0);
}

export function parseTiming(line: string): { start: number; end: number; settings: string } | null {
    const m = TIMING.exec(line);
    if (!m) return null;
    return { start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]), settings: (m[9] ?? "").trim() };
}

/** "00:01:02,500" for SRT, "00:01:02.500" for VTT; whole milliseconds. */
export function formatTime(value: number, format: SubtitleFormat): string {
    const ms = Math.max(0, Math.round(value * 1000));
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${format === "srt" ? "," : "."}${pad(ms % 1000, 3)}`;
}

/* ── Text to cues ────────────────────────────────────────────────────── */

const excerpt = (line: string) => {
    const text = line.trim();
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

function badTiming(lineNumber: number, line: string, format: SubtitleFormat): SubtitleFileError {
    const example = format === "srt" ? "00:01:02,500 --> 00:01:04,000" : "00:01:02.500 --> 00:01:04.000";
    return new SubtitleFileError("bad-timing", `Line ${lineNumber} isn’t a valid timing line.`,
        `It reads “${excerpt(line)}”. A timing line looks like ${example}, with minutes and seconds below 60. Correct that line in a text editor, then choose the file again.`, lineNumber);
}

function noTiming(lineNumber: number, line: string, format: SubtitleFormat): SubtitleFileError {
    return new SubtitleFileError("no-timing", `Line ${lineNumber} isn’t part of a cue.`,
        `It reads “${excerpt(line)}”, but no timing line comes before it${format === "srt" ? " after a cue number" : ""}, so this doesn’t read as ${format === "srt" ? "an SRT" : "a VTT"} file there. Correct it in a text editor, then choose the file again.`, lineNumber);
}

function parseSrt(lines: string[]): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const n = lines.length;
    const blank = (k: number) => lines[k].trim() === "";
    const validTiming = (k: number) => k < n && parseTiming(lines[k]) !== null;
    // Inside a cue's text only a timing line that reads, or a number before one, starts the next cue.
    const nextCueAt = (k: number) => validTiming(k) || (NUMBER_LINE.test(lines[k]) && validTiming(k + 1));
    let i = 0;
    while (i < n) {
        if (blank(i)) { i++; continue; }
        let id: string | undefined;
        let at = i;
        if (!lines[i].includes("-->")) {
            if (NUMBER_LINE.test(lines[i]) && i + 1 < n && lines[i + 1].includes("-->")) {
                id = lines[i];
                at = i + 1;
            } else if (NUMBER_LINE.test(lines[i]) && i + 1 < n && LOOKS_LIKE_TIME.test(lines[i + 1])) {
                throw badTiming(i + 2, lines[i + 1], "srt");
            } else if (LOOKS_LIKE_TIME.test(lines[i])) {
                throw badTiming(i + 1, lines[i], "srt");
            } else if (cues.length) {
                // A blank line inside a cue's text: the rest belongs to that cue.
                const previous = cues[cues.length - 1];
                while (i < n && !blank(i) && !nextCueAt(i)) previous.lines.push(lines[i++]);
                continue;
            } else {
                throw noTiming(i + 1, lines[i], "srt");
            }
        }
        const timing = parseTiming(lines[at]);
        if (!timing) throw badTiming(at + 1, lines[at], "srt");
        const text: string[] = [];
        let k = at + 1;
        while (k < n && !blank(k) && !nextCueAt(k)) text.push(lines[k++]);
        cues.push({ kind: "cue", id, timing: lines[at], ...timing, lines: text, line: at + 1 });
        i = k;
    }
    return cues;
}

const VTT_HEADER = /^WEBVTT(?:[ \t].*)?$/;

function parseVtt(lines: string[]): { header: string[]; blocks: (SubtitleCue | SubtitleBlock)[] } {
    const header = [lines[0]];
    const n = lines.length;
    let i = 1;
    // Header lines (Kind:, Language:) run to the first blank line; a timing line means the blank line was left out.
    while (i < n && lines[i].trim() !== "" && !lines[i].includes("-->")) header.push(lines[i++]);
    const blocks: (SubtitleCue | SubtitleBlock)[] = [];
    while (i < n) {
        if (lines[i].trim() === "") { i++; continue; }
        const first = lines[i];
        const kind = /^NOTE(?:[ \t]|$)/.test(first) ? "note" : /^STYLE[ \t]*$/.test(first) ? "style" : /^REGION[ \t]*$/.test(first) ? "region" : null;
        if (kind) {
            const block: SubtitleBlock = { kind, lines: [] };
            while (i < n && lines[i].trim() !== "") block.lines.push(lines[i++]);
            blocks.push(block);
            continue;
        }
        let id: string | undefined;
        let at = i;
        if (!first.includes("-->")) {
            if (i + 1 < n && lines[i + 1].includes("-->")) { id = first; at = i + 1; }
            else if (i + 1 < n && LOOKS_LIKE_TIME.test(lines[i + 1]) && lines[i + 1].trim() !== "") throw badTiming(i + 2, lines[i + 1], "vtt");
            else if (LOOKS_LIKE_TIME.test(first)) throw badTiming(i + 1, first, "vtt");
            else throw noTiming(i + 1, first, "vtt");
        }
        const timing = parseTiming(lines[at]);
        if (!timing) throw badTiming(at + 1, lines[at], "vtt");
        const text: string[] = [];
        let k = at + 1;
        while (k < n && lines[k].trim() !== "") text.push(lines[k++]);
        blocks.push({ kind: "cue", id, timing: lines[at], ...timing, lines: text, line: at + 1 });
        i = k;
    }
    return { header, blocks };
}

/**
 * The cues and blocks of an SRT or VTT file's text. The format is read from
 * the text itself: a WEBVTT first line is VTT, timing lines without it SRT.
 */
export function parseSubtitles(text: string, { name = "This file", encoding = "UTF-8", bom = false }: { name?: string; encoding?: SubtitleEncoding; bom?: boolean } = {}): SubtitleDocument {
    let body = text;
    if (body.charCodeAt(0) === 0xfeff) { body = body.slice(1); bom = true; }
    if (!body.trim()) throw new SubtitleFileError("empty", `${name} is empty.`, "There are no subtitles in it to translate.");
    const crlf = (body.match(/\r\n/g)?.length ?? 0);
    const breaks = body.match(/\r\n|\r|\n/g)?.length ?? 0;
    const newline = breaks > 0 && crlf * 2 >= breaks ? "\r\n" : "\n";
    // Scanned from the end: a regex for "line breaks at the end" backtracks badly on a long run of them.
    let bodyEnd = body.length;
    while (bodyEnd > 0 && (body[bodyEnd - 1] === "\n" || body[bodyEnd - 1] === "\r")) bodyEnd--;
    const trailing = body.slice(bodyEnd);
    const trailingNewlines = trailing.match(/\r\n|\r|\n/g)?.length ?? 0;
    const lines = body.slice(0, body.length - trailing.length).split(/\r\n|\r|\n/);

    if (/^\s*\[Script Info\]/i.test(body) || /^Dialogue:\s*\d/m.test(body)) {
        throw new SubtitleFileError("ass", `${name} is an ASS or SSA subtitle file.`, "This page translates SRT and VTT files. Subtitle Converter can turn it into SRT first, in your browser.");
    }
    if (VTT_HEADER.test(lines[0])) {
        const { header, blocks } = parseVtt(lines);
        if (!blocks.some(isCue)) throw new SubtitleFileError("no-cues", `${name} has no cues.`, "It is a VTT file, but it holds no timed cues to translate.");
        return { format: "vtt", encoding, bom, newline, header, blocks, trailingNewlines };
    }
    if (!lines.some(line => line.includes("-->"))) {
        throw new SubtitleFileError("not-subtitles", `${name} has no subtitle cues.`,
            "No line in it has a timing such as 00:00:01,000 --> 00:00:04,000. Choose an SRT or VTT subtitle file.");
    }
    const cues = parseSrt(lines);
    return { format: "srt", encoding, bom, newline, header: [], blocks: cues, trailingNewlines };
}

/** A chosen file, read on this device: its size checked, its bytes decoded, its cues parsed and counted. */
export async function readSubtitleFile(file: File): Promise<SubtitleDocument> {
    const name = file.name || "This file";
    if (file.size > MAX_SUBTITLE_BYTES) {
        throw new SubtitleFileError("too-large", `${name} is larger than ${MAX_SUBTITLE_BYTES_LABEL}.`,
            `That is more subtitle text than this page translates at once; a three-hour film’s subtitles are about 200 KB. Split the file into parts in a text editor and translate each one.`);
    }
    const decoded = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()), name);
    const doc = parseSubtitles(decoded.text, { name, encoding: decoded.encoding, bom: decoded.bom });
    const count = cuesOf(doc).length;
    if (count > MAX_SUBTITLE_CUES) {
        throw new SubtitleFileError("too-many-cues", `${name} has ${count.toLocaleString("en-US")} cues.`,
            `This page translates up to ${MAX_SUBTITLE_CUES.toLocaleString("en-US")} at once; a three-hour film has about 2,500. Split the file into parts in a text editor and translate each one.`);
    }
    return doc;
}

/* ── Cues to text ────────────────────────────────────────────────────── */

/** What a file saved in the other format leaves out, because that format can't hold it. */
export interface Dropped {
    /** Formatting the format has no tag for: voice and class spans, colours, positions. */
    tags: number;
    /** VTT cue settings, or SRT's position coordinates. */
    settings: number;
    /** VTT NOTE, STYLE and REGION blocks. */
    blocks: number;
}

export interface WriteOptions {
    format: SubtitleFormat;
    /** New text for each cue, in cue order, in the source file's markup; undefined keeps a cue's own text. */
    texts?: readonly (string | undefined)[];
    /** The language a VTT header's "Language:" line is set to, when the header has one. */
    language?: string;
}

/**
 * Every "-->" made "->", which both formats would read as a timing line: a run
 * of dashes before ">" becomes one, so "--->" goes too. One pass, so a long
 * run of dashes costs no more than its length.
 */
export function withoutArrow(line: string): string {
    if (!line.includes("-->")) return line;
    let out = "";
    let dashes = 0;
    for (const ch of line) {
        if (ch === "-") { dashes++; continue; }
        out += ch === ">" && dashes >= 2 ? "-" : "-".repeat(dashes);
        out += ch;
        dashes = 0;
    }
    return out + "-".repeat(dashes);
}

/** A cue's text as lines a file can hold: a blank line would end the cue, so none is kept. */
function cueLines(text: string): string[] {
    return text.replace(/\r\n?/g, "\n").split("\n").map(line => withoutArrow(line).trimEnd()).filter(line => line.trim() !== "");
}

/**
 * The file's text in `format`: the source's own cues, blocks and timing lines,
 * with `texts` where a cue was translated or edited. In the same format the
 * file round-trips; in the other format timings are rewritten and what the
 * format can't hold is left out and counted.
 */
export function writeSubtitles(doc: SubtitleDocument, { format, texts, language }: WriteOptions): { text: string; dropped: Dropped } {
    const dropped: Dropped = { tags: 0, settings: 0, blocks: 0 };
    const same = format === doc.format;
    const out: string[] = [];
    if (format === "vtt") {
        const header = same ? doc.header.map(line => language && /^Language:/i.test(line) ? `Language: ${language}` : line) : ["WEBVTT"];
        out.push(header.join(doc.newline));
    }
    let cueNumber = 0;
    for (const block of doc.blocks) {
        if (!isCue(block)) {
            if (same) out.push(block.lines.join(doc.newline));
            else dropped.blocks++;
            continue;
        }
        const own = texts?.[cueNumber];
        cueNumber++;
        let lines: string[];
        if (own === undefined && same) lines = block.lines;
        else {
            const converted = convertCueMarkup(own ?? block.lines.join("\n"), doc.format, format);
            dropped.tags += converted.dropped;
            lines = cueLines(converted.text);
        }
        const head: string[] = [];
        if (same) {
            if (block.id !== undefined) head.push(block.id);
            head.push(block.timing);
        } else {
            if (format === "srt") head.push(String(cueNumber));
            else if (block.id !== undefined && block.id.trim()) head.push(withoutArrow(block.id.trim()));
            if (block.settings) dropped.settings++;
            head.push(`${formatTime(block.start, format)} --> ${formatTime(block.end, format)}`);
        }
        out.push([...head, ...lines].join(doc.newline));
    }
    const trailing = same ? doc.trailingNewlines : 1;
    const text = (doc.bom ? "\uFEFF" : "") + out.join(doc.newline + doc.newline) + doc.newline.repeat(trailing);
    return { text, dropped };
}
