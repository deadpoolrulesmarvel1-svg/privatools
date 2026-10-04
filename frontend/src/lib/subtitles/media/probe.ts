/**
 * What a media file is and how long it plays, found without decoding it, and
 * whether that is past a tool's limit. Shared by Subtitle Generator
 * (extract.ts) and Voice Noise Remover (lib/noise/source.ts).
 */
import { ascii, readRange } from "./bytes";

export type MediaKind = "mp4" | "matroska" | "mp3" | "wav" | "other";

/**
 * How far past a length limit a file may run and still be taken. Encoders pad
 * a recording's end (an hour of MP3 comes out at 60:00.04), and a length is
 * told in whole minutes, so anything refused must read as longer than the
 * limit: 30 seconds over is the first length that rounds to a minute more.
 */
const LIMIT_SLACK_SECONDS = 30;

/** Whether `seconds` of sound is past a tool's `limit`, once an encoder's padding is allowed for. */
export const pastLimit = (seconds: number, limit: number) => seconds >= limit + LIMIT_SLACK_SECONDS;

/** Which reader a file needs, from its first bytes rather than its name. */
export async function sniff(file: Blob): Promise<MediaKind> {
    const head = await readRange(file, 0, 12);
    if (head.length >= 8 && ["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"].includes(ascii(head, 4, 4))) return "mp4";
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "matroska";
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return "wav";
    if (ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe6) === 0xe2)) return "mp3";
    return "other";
}

/** How long the browser says a file plays, from its header alone, or null when it cannot say. */
export function playingTime(file: Blob, video: boolean, timeoutMs = 10000): Promise<number | null> {
    return new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const element = document.createElement(video ? "video" : "audio");
        let settled = false;
        const done = (seconds: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            element.removeAttribute("src");
            element.load();
            URL.revokeObjectURL(url);
            resolve(seconds);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        element.preload = "metadata";
        element.muted = true;
        element.onloadedmetadata = () => done(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
        element.onerror = () => done(null);
        element.src = url;
    });
}
