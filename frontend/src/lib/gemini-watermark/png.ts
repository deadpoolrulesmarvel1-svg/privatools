/**
 * PNG read and write for the Gemini sparkle remover, in plain TypeScript.
 *
 * The browser's own decoder would work, but a canvas premultiplies alpha and
 * may convert colours, so a round trip through it is not guaranteed to give
 * back the same pixels. Decoding here keeps every pixel outside the sparkle
 * exactly as it was, and lets the file's other chunks (text, EXIF, XMP, the
 * colour profile, Content Credentials) be copied into the new file unchanged.
 *
 * Supported: 8-bit greyscale, RGB, greyscale with alpha and RGBA, and indexed
 * colour at 1, 2, 4 or 8 bits, not interlaced. Gemini writes 8-bit RGB. An
 * indexed image is written back as RGB or RGBA, because removing the sparkle
 * creates colours its palette does not have.
 */
import { unzlibSync, zlibSync } from "fflate";
import { crc32 } from "@/lib/zip";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class PngError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PngError";
    }
}

export interface PngChunk {
    type: string;
    data: Uint8Array;
}

export interface DecodedPng {
    width: number;
    height: number;
    /** 0 grey, 2 RGB, 3 indexed, 4 grey + alpha, 6 RGBA. */
    colorType: number;
    bitDepth: number;
    /** Every chunk in file order, IDAT included. */
    chunks: PngChunk[];
    /** RGBA, 8 bits per channel, row after row. */
    rgba: Uint8ClampedArray;
}

export function isPng(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && SIGNATURE.every((value, index) => bytes[index] === value);
}

const u32 = (bytes: Uint8Array, at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

function typeName(bytes: Uint8Array, at: number): string {
    return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * Split a PNG into its chunks, up to IEND. A critical chunk (IHDR, PLTE,
 * IDAT) with a bad checksum means a damaged file; ancillary chunks are copied
 * as they are, so their checksums are not second-guessed.
 */
export function readChunks(bytes: Uint8Array): PngChunk[] {
    if (!isPng(bytes)) throw new PngError("This is not a PNG file.");
    const chunks: PngChunk[] = [];
    let at = 8;
    while (at + 12 <= bytes.length) {
        const length = u32(bytes, at);
        const type = typeName(bytes, at + 4);
        const end = at + 12 + length;
        if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.length) throw new PngError("This PNG file is damaged or incomplete.");
        const data = bytes.subarray(at + 8, at + 8 + length);
        const critical = type.charCodeAt(0) < 97;
        if (critical && crc32(bytes.subarray(at + 4, at + 8 + length)) !== u32(bytes, at + 8 + length)) {
            throw new PngError("This PNG file is damaged: a checksum does not match.");
        }
        at = end;
        if (type === "IEND") return chunks;
        chunks.push({ type, data });
    }
    // Some writers leave IEND off. The image data, checked when it is inflated, is what matters.
    return chunks;
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverse the per-row filters in place. `bpp` is bytes per complete pixel, at least 1. */
function unfilter(raw: Uint8Array, rowBytes: number, rows: number, bpp: number): Uint8Array {
    const out = new Uint8Array(rowBytes * rows);
    for (let y = 0; y < rows; y++) {
        const filter = raw[y * (rowBytes + 1)];
        const src = y * (rowBytes + 1) + 1;
        const row = y * rowBytes;
        const prev = row - rowBytes;
        for (let x = 0; x < rowBytes; x++) {
            const left = x >= bpp ? out[row + x - bpp] : 0;
            const up = y > 0 ? out[prev + x] : 0;
            const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
            const value = raw[src + x];
            switch (filter) {
                case 0: out[row + x] = value; break;
                case 1: out[row + x] = value + left; break;
                case 2: out[row + x] = value + up; break;
                case 3: out[row + x] = value + ((left + up) >> 1); break;
                case 4: out[row + x] = value + paeth(left, up, upLeft); break;
                default: throw new PngError("This PNG file is damaged: it uses an unknown row filter.");
            }
        }
    }
    return out;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Width and height from the header alone, without reading the image data. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
    if (!isPng(bytes) || bytes.length < 24 || typeName(bytes, 12) !== "IHDR") throw new PngError("This PNG file is damaged: its header is missing.");
    return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

export function decodePng(bytes: Uint8Array): DecodedPng {
    const chunks = readChunks(bytes);
    const header = chunks[0];
    if (header?.type !== "IHDR" || header.data.length !== 13) throw new PngError("This PNG file is damaged: its header is missing.");
    const width = u32(header.data, 0);
    const height = u32(header.data, 4);
    const [bitDepth, colorType, compression, filterMethod, interlace] = header.data.subarray(8, 13);
    if (!width || !height || compression !== 0 || filterMethod !== 0 || !(colorType in CHANNELS)) {
        throw new PngError("This PNG file is damaged: its header is not valid.");
    }
    if (chunks.some(chunk => chunk.type === "acTL")) throw new PngError("Animated PNG files are not supported. Save a single frame as a PNG and try again.");
    if (interlace !== 0) throw new PngError("Interlaced PNG files are not supported. Save the image as an ordinary PNG and try again.");
    if (bitDepth === 16) throw new PngError("16-bit PNG files are not supported. Save the image as an 8-bit PNG and try again.");
    const indexed = colorType === 3;
    if (indexed ? ![1, 2, 4, 8].includes(bitDepth) : bitDepth !== 8) {
        throw new PngError("This PNG uses a colour depth the tool does not support. Save it as an 8-bit PNG and try again.");
    }

    const channels = CHANNELS[colorType];
    const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
    const idat = chunks.filter(chunk => chunk.type === "IDAT");
    if (!idat.length) throw new PngError("This PNG file is damaged: it has no image data.");
    const joined = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.data.length, 0));
    let offset = 0;
    for (const chunk of idat) { joined.set(chunk.data, offset); offset += chunk.data.length; }
    let raw: Uint8Array;
    try {
        raw = unzlibSync(joined);
    } catch {
        throw new PngError("This PNG file is damaged: its image data cannot be read.");
    }
    if (raw.length < (rowBytes + 1) * height) throw new PngError("This PNG file is damaged or incomplete.");
    const pixels = unfilter(raw, rowBytes, height, Math.max(1, (channels * bitDepth) >> 3));

    const rgba = new Uint8ClampedArray(width * height * 4);
    const trns = chunks.find(chunk => chunk.type === "tRNS")?.data;
    if (indexed) {
        const palette = chunks.find(chunk => chunk.type === "PLTE")?.data;
        if (!palette || palette.length % 3) throw new PngError("This PNG file is damaged: its palette is missing.");
        const perByte = 8 / bitDepth;
        const mask = (1 << bitDepth) - 1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const byte = pixels[y * rowBytes + Math.floor(x / perByte)];
                const index = (byte >> ((perByte - 1 - (x % perByte)) * bitDepth)) & mask;
                if (index * 3 + 2 >= palette.length) throw new PngError("This PNG file is damaged: a pixel points outside its palette.");
                const o = (y * width + x) * 4;
                rgba[o] = palette[index * 3];
                rgba[o + 1] = palette[index * 3 + 1];
                rgba[o + 2] = palette[index * 3 + 2];
                rgba[o + 3] = trns && index < trns.length ? trns[index] : 255;
            }
        }
    } else {
        const key = trns && colorType === 0 && trns.length >= 2 ? [trns[1]]
            : trns && colorType === 2 && trns.length >= 6 ? [trns[1], trns[3], trns[5]] : null;
        for (let i = 0, p = 0; i < width * height; i++, p += channels) {
            const o = i * 4;
            if (colorType === 0 || colorType === 4) {
                rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p];
                rgba[o + 3] = colorType === 4 ? pixels[p + 1] : key && pixels[p] === key[0] ? 0 : 255;
            } else {
                rgba[o] = pixels[p];
                rgba[o + 1] = pixels[p + 1];
                rgba[o + 2] = pixels[p + 2];
                rgba[o + 3] = colorType === 6 ? pixels[p + 3]
                    : key && pixels[p] === key[0] && pixels[p + 1] === key[1] && pixels[p + 2] === key[2] ? 0 : 255;
            }
        }
    }
    return { width, height, colorType, bitDepth, chunks, rgba };
}

/** Chunks that describe the palette. They stop being true when an indexed image is saved as full colour. */
const PALETTE_CHUNKS = new Set(["PLTE", "tRNS", "bKGD", "hIST", "sBIT", "sPLT"]);

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/** Filter each row with whichever of the five filters leaves the smallest sum, the usual heuristic. */
function filterRows(pixels: Uint8Array, rowBytes: number, rows: number, bpp: number): Uint8Array {
    const out = new Uint8Array((rowBytes + 1) * rows);
    const candidate = new Uint8Array(rowBytes);
    const best = new Uint8Array(rowBytes);
    for (let y = 0; y < rows; y++) {
        const row = y * rowBytes;
        const prev = row - rowBytes;
        let bestFilter = 0;
        let bestScore = Infinity;
        for (let filter = 0; filter < 5; filter++) {
            let score = 0;
            for (let x = 0; x < rowBytes; x++) {
                const value = pixels[row + x];
                const left = x >= bpp ? pixels[row + x - bpp] : 0;
                const up = y > 0 ? pixels[prev + x] : 0;
                const upLeft = y > 0 && x >= bpp ? pixels[prev + x - bpp] : 0;
                const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
                    : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
                const residual = (value - predicted) & 0xff;
                candidate[x] = residual;
                score += residual < 128 ? residual : 256 - residual;
                if (score >= bestScore) break;
            }
            if (score < bestScore) {
                bestScore = score;
                bestFilter = filter;
                best.set(candidate);
            }
        }
        out[y * (rowBytes + 1)] = bestFilter;
        out.set(best, y * (rowBytes + 1) + 1);
    }
    return out;
}

/**
 * Write `rgba` as a PNG that keeps the source file's other chunks, in their
 * places before or after the image data. Greyscale, RGB, greyscale with alpha
 * and RGBA keep their colour type; an indexed image becomes RGB, or RGBA if
 * any pixel is not opaque.
 */
export function encodePng(source: DecodedPng, rgba: Uint8ClampedArray): Uint8Array<ArrayBuffer> {
    const { width, height } = source;
    if (rgba.length !== width * height * 4) throw new PngError("The image changed size while it was processed.");
    let colorType = source.colorType;
    if (colorType === 3) {
        let opaque = true;
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
        colorType = opaque ? 2 : 6;
    }
    const channels = CHANNELS[colorType];
    const rowBytes = width * channels;
    const pixels = new Uint8Array(rowBytes * height);
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
        const o = i * 4;
        if (channels <= 2) {
            pixels[p] = rgba[o];
            if (channels === 2) pixels[p + 1] = rgba[o + 3];
        } else {
            pixels[p] = rgba[o];
            pixels[p + 1] = rgba[o + 1];
            pixels[p + 2] = rgba[o + 2];
            if (channels === 4) pixels[p + 3] = rgba[o + 3];
        }
    }
    const compressed = zlibSync(filterRows(pixels, rowBytes, height, channels), { level: 6 });

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header.set([8, colorType, 0, 0, 0], 8);

    const dropPalette = source.colorType === 3;
    const kept = (chunk: PngChunk) => !["IHDR", "IDAT", "IEND"].includes(chunk.type) && !(dropPalette && PALETTE_CHUNKS.has(chunk.type));
    const firstData = source.chunks.findIndex(chunk => chunk.type === "IDAT");
    const before = source.chunks.slice(0, firstData).filter(kept);
    const after = source.chunks.slice(firstData).filter(kept);

    const parts: Uint8Array[] = [Uint8Array.from(SIGNATURE), chunkBytes("IHDR", header)];
    for (const chunk of before) parts.push(chunkBytes(chunk.type, chunk.data));
    const IDAT_SIZE = 1 << 18;
    for (let at = 0; at < compressed.length; at += IDAT_SIZE) parts.push(chunkBytes("IDAT", compressed.subarray(at, at + IDAT_SIZE)));
    for (const chunk of after) parts.push(chunkBytes(chunk.type, chunk.data));
    parts.push(chunkBytes("IEND", new Uint8Array(0)));

    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}
