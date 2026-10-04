/**
 * WAV in and out.
 *
 * Out: the cleaned sound is written as 16-bit PCM, the WAV every player and
 * editor opens, a block at a time; the 44-byte header, which holds the sizes,
 * goes in front once the length is known. A plain WAV's sizes are 32-bit, so
 * it holds at most about 4 GB of sound, far more than the tool's limit.
 *
 * In: decodeWav reads the PCM pieces lib/subtitles/media/wav.ts cuts from a
 * WAV file (and any plain PCM or float WAV): 8, 16, 24 and 32-bit integers
 * and 32 and 64-bit floats, into one array of samples per channel.
 */

export const WAV_HEADER_BYTES = 44;
/** The most sound data a 32-bit RIFF size can describe after the header. */
export const MAX_WAV_DATA_BYTES = 0xffffffff - (WAV_HEADER_BYTES - 8);

/** The header of a 16-bit PCM WAV holding `frames` sample frames. */
export function wavHeader(channels: number, sampleRate: number, frames: number): Uint8Array<ArrayBuffer> {
    const blockAlign = channels * 2;
    const dataBytes = frames * blockAlign;
    if (dataBytes > MAX_WAV_DATA_BYTES) throw new RangeError("Too much sound for one WAV file");
    const header = new Uint8Array(WAV_HEADER_BYTES);
    const view = new DataView(header.buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) header[at + i] = value.charCodeAt(i); };
    text(0, "RIFF");
    view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, dataBytes, true);
    return header;
}

/**
 * Channels as interleaved 16-bit samples, `length` frames from `from`. Values
 * past full scale are held at it and counted.
 */
export function toPcm16(channels: readonly Float32Array[], from = 0, length = channels[0].length - from): { pcm: Int16Array<ArrayBuffer>; clipped: number } {
    const count = channels.length;
    const pcm = new Int16Array(length * count);
    let clipped = 0;
    for (let c = 0; c < count; c++) {
        const channel = channels[c];
        for (let i = 0; i < length; i++) {
            let value = channel[from + i];
            if (value > 1) { value = 1; clipped++; } else if (value < -1) { value = -1; clipped++; }
            pcm[i * count + c] = Math.round(value * 32767);
        }
    }
    return { pcm, clipped };
}

export interface DecodedWav {
    sampleRate: number;
    channels: Float32Array[];
}

/** A WAV file's samples, or an error saying what it holds that this can't read. */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const ascii = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (bytes.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw new Error("Not a WAV file");
    let format: { tag: number; channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
    for (let at = 12; at + 8 <= bytes.length;) {
        const id = ascii(at);
        const size = view.getUint32(at + 4, true);
        if (id === "fmt " && at + 24 <= bytes.length) {
            let tag = view.getUint16(at + 8, true);
            // WAVE_FORMAT_EXTENSIBLE names the real format in the first two bytes of its sub-format GUID.
            if (tag === 0xfffe && size >= 40 && at + 34 <= bytes.length) tag = view.getUint16(at + 32, true);
            format = { tag, channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true), blockAlign: view.getUint16(at + 20, true), bits: view.getUint16(at + 22, true) };
        }
        if (id === "data") {
            if (!format) throw new Error("This WAV file has no format chunk before its sound");
            const { tag, channels, sampleRate, bits, blockAlign } = format;
            const width = bits / 8;
            const supported = (tag === 1 && [8, 16, 24, 32].includes(bits)) || (tag === 3 && [32, 64].includes(bits));
            if (!supported || channels < 1 || !sampleRate || blockAlign !== channels * width) throw new Error(`This WAV’s sound is in a format this tool doesn’t read (format ${tag}, ${bits}-bit)`);
            const start = at + 8;
            const end = Math.min(bytes.length, start + size);
            const frames = Math.floor((end - start) / blockAlign);
            const out = Array.from({ length: channels }, () => new Float32Array(frames));
            for (let i = 0; i < frames; i++) {
                for (let c = 0; c < channels; c++) {
                    const p = start + i * blockAlign + c * width;
                    let value: number;
                    if (tag === 3) value = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
                    else if (bits === 8) value = (bytes[p] - 128) / 128;
                    else if (bits === 16) value = view.getInt16(p, true) / 32768;
                    else if (bits === 24) value = (((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8) >> 8) / 8388608;
                    else value = view.getInt32(p, true) / 2147483648;
                    out[c][i] = value;
                }
            }
            return { sampleRate, channels: out };
        }
        at += 8 + size + (size & 1);
    }
    throw new Error("This WAV file holds no sound data");
}
