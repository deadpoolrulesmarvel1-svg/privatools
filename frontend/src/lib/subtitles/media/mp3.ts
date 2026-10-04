/**
 * The sound of an MP3 file, cut between frames.
 *
 * MPEG audio is a run of frames that each say their own length, so any run
 * of whole frames is a stream a decoder can play. The frames are walked once
 * to find where they start; each piece is then one slice of the file. A
 * Xing, Info or VBRI frame at the start carries no sound: it stays in the
 * first piece, where the decoder expects it, and is left out of the timing.
 */
import { ascii, WindowedReader } from "./bytes";
import { PIECE_SECONDS, type AudioIndex, type AudioPiece } from "./types";

const BITRATES: Record<string, number[]> = {
    "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface MpegFrame { length: number; samples: number; sampleRate: number; version: number; layer: number; mono: boolean }

/** The MPEG audio frame header at b[at], or null when none starts there. */
export function mpegFrame(b: Uint8Array, at: number): MpegFrame | null {
    if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
    const version = (b[at + 1] >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layer = 4 - ((b[at + 1] >> 1) & 3); // 1, 2 or 3
    const bitrateIndex = b[at + 2] >> 4;
    const rateIndex = (b[at + 2] >> 2) & 3;
    if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
    const bitrate = BITRATES[`${version === 3 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
    const sampleRate = RATES[version][rateIndex];
    const padding = (b[at + 2] >> 1) & 1;
    const samples = layer === 1 ? 384 : layer === 2 || version === 3 ? 1152 : 576;
    const length = layer === 1 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    return { length, samples, sampleRate, version, layer, mono: b[at + 3] >> 6 === 3 };
}

/** Whether a frame is a Xing, Info or VBRI header rather than sound. */
function isInfoFrame(b: Uint8Array, at: number, frame: MpegFrame): boolean {
    const sideInfo = frame.version === 3 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
    const tag = ascii(b, at + 4 + sideInfo, 4);
    return tag === "Xing" || tag === "Info" || ascii(b, at + 36, 4) === "VBRI";
}

/** Skip an ID3v2 tag: "ID3", version, flags, then a 28-bit size in four seven-bit bytes. */
function afterId3(b: Uint8Array): number {
    if (ascii(b, 0, 3) !== "ID3") return 0;
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** The next position from `from` where two frames in a row agree, within 64 KB, or -1. */
async function sync(reader: WindowedReader, from: number): Promise<number> {
    const b = await reader.bytes(from, 64 * 1024 + 4);
    for (let i = 0; i + 4 <= b.length; i++) {
        const frame = mpegFrame(b, i);
        if (!frame) continue;
        const next = await reader.bytes(from + i + frame.length, 4);
        const second = mpegFrame(next, 0);
        if (second && second.sampleRate === frame.sampleRate && second.layer === frame.layer) return from + i;
        // The last frame of the file has no frame after it.
        if (from + i + frame.length === reader.size) return from + i;
    }
    return -1;
}

/** The sound of an MP3 file as pieces of about a minute, or null when it is not one. `signal` stops the walk. */
export async function indexMp3(blob: Blob, { pieceSeconds = PIECE_SECONDS, leadSeconds = 0, onRead, signal }: { pieceSeconds?: number; leadSeconds?: number; onRead?: (bytes: number) => void; signal?: AbortSignal } = {}): Promise<AudioIndex | null> {
    const reader = new WindowedReader(blob);
    const start = await sync(reader, afterId3(await reader.bytes(0, 10)));
    if (start < 0) return null;
    const head = await reader.bytes(start, 64);
    const first = mpegFrame(head, 0)!;
    const info = isInfoFrame(head, 0, first);
    const offsets: number[] = [];
    let at = start;
    while (at + 4 <= blob.size) {
        const frame = mpegFrame(await reader.bytes(at, 4), 0);
        if (!frame || at + frame.length > blob.size) {
            // Junk or a tag between frames: look for the next run, or stop at the end of the sound.
            const next = frame ? -1 : await sync(reader, at + 1);
            if (next < 0) break;
            at = next;
            continue;
        }
        offsets.push(at);
        at += frame.length;
        if (offsets.length % 4096 === 0) {
            onRead?.(at);
            signal?.throwIfAborted();
        }
    }
    onRead?.(at);
    const end = at;
    const audioFrames = offsets.length - (info ? 1 : 0);
    if (audioFrames <= 0) return null;
    const secondsPerFrame = first.samples / first.sampleRate;
    const perPiece = Math.max(1, Math.round(pieceSeconds / secondsPerFrame));
    const pieces: AudioPiece[] = [];
    const firstAudio = info ? 1 : 0;
    // A piece after the first may start this many frames early: its lead, for the decoder's bit reservoir and overlap.
    const leadFrames = Math.max(0, Math.ceil(leadSeconds / secondsPerFrame - 1e-9));
    // Frame k (counting the info frame, if any, as -1) starts at k × secondsPerFrame.
    for (let frame = firstAudio; frame < offsets.length; frame += perPiece) {
        const leadFrom = frame === firstAudio ? frame : Math.max(firstAudio, frame - leadFrames);
        const from = frame === firstAudio && info ? 0 : leadFrom;
        const to = Math.min(offsets.length, frame + perPiece);
        const sliceEnd = to < offsets.length ? offsets[to] : end;
        const audioIndex = frame - firstAudio;
        pieces.push({
            start: audioIndex * secondsPerFrame,
            duration: (to - frame) * secondsPerFrame,
            lead: (frame - leadFrom) * secondsPerFrame,
            read: async () => blob.slice(offsets[from], sliceEnd).arrayBuffer(),
        });
    }
    return { container: "MP3", durationSeconds: audioFrames * secondsPerFrame, sampleRate: first.sampleRate, codec: "mp3", pieces };
}
