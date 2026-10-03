/**
 * Timed speech text, and the two subtitle formats it is saved in: SubRip
 * (.srt) and WebVTT (.vtt). Transcribe Audio and Subtitle Generator write
 * their files here, so both formats follow the same rules.
 */
export interface SpeechSegment { start: number; end: number; text: string; }

/**
 * "HH:MM:SS,mmm" for SubRip, "HH:MM:SS.mmm" for WebVTT. The time is rounded to
 * the millisecond before it is split, so 59.9996 s is a whole minute rather
 * than "00:00:59,1000". A negative or non-finite time is written as zero.
 */
export function subtitleTime(seconds: number, separator: "," | "."): string {
    const milliseconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds * 1000 : 0));
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    return `${pad(Math.floor(milliseconds / 3600000))}:${pad(Math.floor(milliseconds / 60000) % 60)}:${pad(Math.floor(milliseconds / 1000) % 60)}${separator}${pad(milliseconds % 1000, 3)}`;
}

export function transcriptTime(seconds: number): string {
    return subtitleTime(seconds, ",");
}

/**
 * A line with every "-->" made "->": both formats read the arrow as a timing
 * line. One pass would leave "--->" as "-->", so it repeats until none is left.
 */
function withoutArrow(line: string): string {
    let text = line;
    while (text.includes("-->")) text = text.split("-->").join("->");
    return text;
}

/** A cue's lines as both formats can carry them: a blank line ends a cue, so none is kept, and no line holds "-->". */
function cueLines(text: string): string[] {
    return text.replace(/\r\n?/g, "\n").split("\n")
        .map(line => withoutArrow(line).replace(/[ \t\f\v]+/g, " ").trim())
        .filter(Boolean);
}

/** WebVTT reads "&" and "<" as markup; ">" is escaped too so no line can be taken for a tag. */
function vttLine(line: string): string {
    return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The cues that have text, with their lines. */
function writable(cues: readonly SpeechSegment[]) {
    return cues.map(cue => ({ cue, lines: cueLines(cue.text) })).filter(entry => entry.lines.length > 0);
}

/** SubRip: numbered cues from 1, a blank line between them, a newline at the end. Cues without text are left out. */
export function toSrt(cues: readonly SpeechSegment[]): string {
    return writable(cues)
        .map(({ cue, lines }, index) => `${index + 1}\n${subtitleTime(cue.start, ",")} --> ${subtitleTime(cue.end, ",")}\n${lines.join("\n")}\n`)
        .join("\n");
}

/** WebVTT: the WEBVTT header, then the cues, a blank line between them. Cues without text are left out. */
export function toVtt(cues: readonly SpeechSegment[]): string {
    const blocks = writable(cues)
        .map(({ cue, lines }) => `${subtitleTime(cue.start, ".")} --> ${subtitleTime(cue.end, ".")}\n${lines.map(vttLine).join("\n")}\n`);
    return `WEBVTT\n\n${blocks.join("\n")}`;
}

/** Transcribe Audio's .srt: one cue per recognised segment. */
export function transcriptSrt(segments: SpeechSegment[]): string {
    return toSrt(segments);
}
