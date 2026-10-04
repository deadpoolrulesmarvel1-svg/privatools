/**
 * The sound of a WAV file, cut into pieces of whole sample frames. Each piece
 * gets a WAV header of its own, so the browser decodes and resamples it as it
 * would the whole file.
 */
import { ascii, concat, WindowedReader } from "./bytes";
import { PIECE_SECONDS, type AudioIndex, type AudioPiece } from "./types";

const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 2 ** 24;

interface Format { float: boolean; channels: number; sampleRate: number; blockAlign: number; bits: number }

function readFormat(b: Uint8Array): Format | null {
    let tag = le16(b, 0);
    // WAVE_FORMAT_EXTENSIBLE names the real format in the first two bytes of its sub-format GUID.
    if (tag === 0xfffe && b.length >= 26) tag = le16(b, 24);
    const format = { float: tag === 3, channels: le16(b, 2), sampleRate: le32(b, 4), blockAlign: le16(b, 12), bits: le16(b, 14) };
    const supported = (tag === 1 && [8, 16, 24, 32].includes(format.bits)) || (tag === 3 && [32, 64].includes(format.bits));
    return supported && format.channels > 0 && format.sampleRate > 0 && format.blockAlign === format.channels * (format.bits / 8) ? format : null;
}

/** A 44-byte header for `dataLength` bytes of samples in `format`. */
function header(format: Format, dataLength: number): Uint8Array {
    const b = new Uint8Array(44);
    const view = new DataView(b.buffer);
    b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    view.setUint32(4, 36 + dataLength, true);
    b.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8); // WAVEfmt
    view.setUint32(16, 16, true);
    view.setUint16(20, format.float ? 3 : 1, true);
    view.setUint16(22, format.channels, true);
    view.setUint32(24, format.sampleRate, true);
    view.setUint32(28, format.sampleRate * format.blockAlign, true);
    view.setUint16(32, format.blockAlign, true);
    view.setUint16(34, format.bits, true);
    b.set([0x64, 0x61, 0x74, 0x61], 36); // data
    view.setUint32(40, dataLength, true);
    return b;
}

/** The sound of a WAV file as pieces of about a minute, or null when it is not a WAV file this reader can cut. */
export async function indexWav(blob: Blob, { pieceSeconds = PIECE_SECONDS }: { pieceSeconds?: number } = {}): Promise<AudioIndex | null> {
    const reader = new WindowedReader(blob, 256 * 1024);
    const riff = await reader.bytes(0, 12);
    if (ascii(riff, 0, 4) !== "RIFF" || ascii(riff, 8, 4) !== "WAVE") return null;
    let format: Format | null = null;
    let dataStart = -1;
    let dataLength = 0;
    for (let at = 12; at + 8 <= blob.size;) {
        const chunk = await reader.bytes(at, 8);
        const id = ascii(chunk, 0, 4);
        const size = le32(chunk, 4);
        if (id === "fmt ") format = readFormat((await reader.bytes(at + 8, Math.min(size, 64))).slice());
        if (id === "data") {
            dataStart = at + 8;
            // A recorder that stopped before writing the size leaves 0 or 0xFFFFFFFF: the data runs to the end.
            dataLength = size === 0 || size === 0xffffffff || dataStart + size > blob.size ? blob.size - dataStart : size;
            break;
        }
        at += 8 + size + (size & 1);
    }
    if (!format || dataStart < 0) return null;
    const fmt = format;
    const frames = Math.floor(dataLength / fmt.blockAlign);
    if (!frames) return null;
    const perPiece = Math.max(1, Math.round(pieceSeconds * fmt.sampleRate));
    const pieces: AudioPiece[] = [];
    for (let first = 0; first < frames; first += perPiece) {
        const count = Math.min(perPiece, frames - first);
        const from = dataStart + first * fmt.blockAlign;
        pieces.push({
            start: first / fmt.sampleRate,
            duration: count / fmt.sampleRate,
            read: async () => concat([header(fmt, count * fmt.blockAlign), new Uint8Array(await blob.slice(from, from + count * fmt.blockAlign).arrayBuffer())]),
        });
    }
    return { container: "WAV", durationSeconds: frames / fmt.sampleRate, sampleRate: fmt.sampleRate, codec: "pcm", pieces };
}
