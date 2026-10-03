/**
 * Reading a file in pieces. A video can be several gigabytes, and the sound
 * in it a few percent of that, so the container readers never load a file
 * whole: they read what they parse, a window at a time.
 */

/** Bytes [start, end) of a file. */
export async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await blob.slice(Math.max(0, start), Math.min(blob.size, end)).arrayBuffer());
}

/**
 * Random reads through a sliding window, for readers that move forward
 * through a file: each window read is large, so walking element headers
 * costs one read per few megabytes rather than one per header.
 */
export class WindowedReader {
    private window: Uint8Array = new Uint8Array(0);
    private windowStart = 0;

    constructor(readonly blob: Blob, private readonly windowSize = 4 * 1024 * 1024) {}

    get size(): number { return this.blob.size; }

    /** Bytes [position, position + length), shorter only at the end of the file. */
    async bytes(position: number, length: number): Promise<Uint8Array> {
        const end = Math.min(this.blob.size, position + length);
        if (position < this.windowStart || end > this.windowStart + this.window.length) {
            this.windowStart = position;
            this.window = await readRange(this.blob, position, Math.max(end, position + this.windowSize));
        }
        return this.window.subarray(position - this.windowStart, end - this.windowStart);
    }
}

export const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
export const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
/** A 64-bit unsigned integer as a number; exact up to 2^53, which no file reaches. */
export const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
export const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));

/** Concatenate byte arrays into one ArrayBuffer, as decodeAudioData takes. */
export function concat(parts: readonly Uint8Array[]): ArrayBuffer {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out.buffer;
}
