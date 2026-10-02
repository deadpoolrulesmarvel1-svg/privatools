/**
 * JPEG and WebP files are decoded and re-encoded by the browser, which drops
 * everything but the pixels. These helpers put the original file's metadata
 * (EXIF, XMP, the colour profile, IPTC, Content Credentials and comments)
 * back into the new file unchanged, so removing the sparkle does not strip
 * provenance or other information from it.
 */

export type ImageFormat = "png" | "jpeg" | "webp";

/** The format from the file's first bytes, whatever it is called. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
    return null;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
    let text = "";
    for (let i = at; i < at + length && i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return text;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}

// ── JPEG ──────────────────────────────────────────────────────────────────

interface JpegSegment {
    marker: number;
    /** The whole segment: FF, marker, length and payload. */
    bytes: Uint8Array;
}

/** Segments from SOI up to (not including) the first scan, plus where the first non-metadata segment starts. */
function jpegHeader(bytes: Uint8Array): { segments: JpegSegment[]; bodyStart: number } {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("This is not a JPEG file.");
    const segments: JpegSegment[] = [];
    let at = 2;
    let bodyStart = -1;
    while (at + 4 <= bytes.length) {
        if (bytes[at] !== 0xff) throw new Error("This JPEG file is damaged.");
        let markerAt = at;
        while (bytes[markerAt + 1] === 0xff) markerAt++; // fill bytes
        const marker = bytes[markerAt + 1];
        const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
        if (!isMetadata && bodyStart < 0) bodyStart = at;
        if (marker === 0xda || marker === 0xd9) break;
        const length = (bytes[markerAt + 2] << 8) | bytes[markerAt + 3];
        const end = markerAt + 2 + length;
        if (length < 2 || end > bytes.length) throw new Error("This JPEG file is damaged or incomplete.");
        segments.push({ marker, bytes: bytes.subarray(at, end) });
        at = end;
    }
    if (bodyStart < 0) throw new Error("This JPEG file is damaged or incomplete.");
    return { segments, bodyStart };
}

const payloadStartsWith = (segment: JpegSegment, text: string) => ascii(segment.bytes, 4, text.length) === text;

/**
 * The original's metadata segments to carry over: every APPn and comment
 * segment, except those that describe the old encoding rather than the
 * picture. APP14 "Adobe" says how the colour channels were transformed, which
 * would be wrong for the new data; APP2 "MPF" points at byte offsets of extra
 * images appended to the old file, which the new one does not have; and a
 * CMYK or greyscale colour profile cannot describe the RGB data the browser
 * writes. An RGB profile is kept: the pixels are read without converting them
 * out of it.
 */
export function jpegMetadata(bytes: Uint8Array): JpegSegment[] {
    const segments = jpegHeader(bytes).segments;
    const isIcc = (segment: JpegSegment) => segment.marker === 0xe2 && payloadStartsWith(segment, "ICC_PROFILE\0");
    const firstIcc = segments.find(segment => isIcc(segment) && segment.bytes[16] === 1);
    const rgbProfile = firstIcc ? ascii(firstIcc.bytes, 18 + 16, 4) === "RGB " : true;
    return segments.filter(segment => {
        const isMetadata = (segment.marker >= 0xe0 && segment.marker <= 0xef) || segment.marker === 0xfe;
        if (!isMetadata) return false;
        if (segment.marker === 0xee && payloadStartsWith(segment, "Adobe")) return false;
        if (segment.marker === 0xe2 && payloadStartsWith(segment, "MPF\0")) return false;
        if (isIcc(segment) && !rgbProfile) return false;
        return true;
    });
}

/** The EXIF orientation (1–8) in an APP1 segment, or null. */
function orientationOffset(segment: Uint8Array): { at: number; little: boolean } | null {
    if (segment[1] !== 0xe1 || ascii(segment, 4, 6) !== "Exif\0\0") return null;
    const tiff = 10;
    const little = ascii(segment, tiff, 2) === "II";
    if (!little && ascii(segment, tiff, 2) !== "MM") return null;
    const u16 = (at: number) => little ? segment[at] | (segment[at + 1] << 8) : (segment[at] << 8) | segment[at + 1];
    const u32 = (at: number) => little
        ? (segment[at] | (segment[at + 1] << 8) | (segment[at + 2] << 16) | (segment[at + 3] << 24)) >>> 0
        : ((segment[at] << 24) | (segment[at + 1] << 16) | (segment[at + 2] << 8) | segment[at + 3]) >>> 0;
    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > segment.length) return null;
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
        const entry = ifd + 2 + k * 12;
        if (entry + 12 > segment.length) return null;
        if (u16(entry) === 0x0112 && u16(entry + 2) === 3) return { at: entry + 8, little };
    }
    return null;
}

export function exifOrientation(bytes: Uint8Array): number {
    for (const segment of jpegHeader(bytes).segments) {
        const found = orientationOffset(segment.bytes);
        if (found) {
            const value = found.little ? segment.bytes[found.at] | (segment.bytes[found.at + 1] << 8) : (segment.bytes[found.at] << 8) | segment.bytes[found.at + 1];
            return value >= 1 && value <= 8 ? value : 1;
        }
    }
    return 1;
}

/**
 * Build the output JPEG: SOI, the original's metadata segments, then the
 * browser's quantisation tables, frame and scan data. When the browser has
 * already turned the picture upright (`upright`), the copied EXIF orientation
 * is set to 1 so viewers do not rotate it a second time.
 */
export function spliceJpeg(original: Uint8Array, encoded: Uint8Array, upright: boolean): Uint8Array<ArrayBuffer> {
    const metadata = jpegMetadata(original).map(segment => {
        const found = upright ? orientationOffset(segment.bytes) : null;
        if (!found) return segment.bytes;
        const copy = Uint8Array.from(segment.bytes);
        copy[found.at] = found.little ? 1 : 0;
        copy[found.at + 1] = found.little ? 0 : 1;
        return copy;
    });
    const { bodyStart } = jpegHeader(encoded);
    return concat([Uint8Array.of(0xff, 0xd8), ...metadata, encoded.subarray(bodyStart)]);
}

// ── WebP ──────────────────────────────────────────────────────────────────

interface RiffChunk {
    type: string;
    data: Uint8Array;
}

function webpChunks(bytes: Uint8Array): RiffChunk[] {
    if (sniffFormat(bytes) !== "webp") throw new Error("This is not a WebP file.");
    const chunks: RiffChunk[] = [];
    const end = Math.min(bytes.length, 8 + (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0);
    let at = 12;
    while (at + 8 <= end) {
        const type = ascii(bytes, at, 4);
        const size = (bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)) >>> 0;
        if (at + 8 + size > bytes.length) throw new Error("This WebP file is damaged or incomplete.");
        chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + size) });
        at += 8 + size + (size & 1);
    }
    return chunks;
}

export interface WebpInfo {
    lossless: boolean;
    animated: boolean;
}

export function inspectWebp(bytes: Uint8Array): WebpInfo {
    const chunks = webpChunks(bytes);
    const vp8x = chunks.find(chunk => chunk.type === "VP8X");
    const animated = Boolean(vp8x && vp8x.data[0] & 0x02) || chunks.some(chunk => chunk.type === "ANIM" || chunk.type === "ANMF");
    const lossless = chunks.some(chunk => chunk.type === "VP8L") && !chunks.some(chunk => chunk.type === "VP8 ");
    return { lossless, animated };
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + data.length + (data.length & 1));
    for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(data, 8);
    return out;
}

const IMAGE_CHUNKS = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ANIM", "ANMF"]);

function riffFile(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const body = concat([Uint8Array.from("WEBP", c => c.charCodeAt(0)), ...chunks]);
    const out = new Uint8Array(8 + body.length);
    out.set([0x52, 0x49, 0x46, 0x46]);
    new DataView(out.buffer).setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
}

/**
 * Build the output WebP from the browser's image data plus the original's
 * colour profile, EXIF, XMP and any other chunks, in the extended layout
 * the format requires for them (VP8X, ICCP, image, EXIF, XMP, others).
 * Metadata the browser's encoder adds of its own (Chrome writes an sRGB
 * profile) is left out, so the file carries only what it came with.
 */
export function spliceWebp(original: Uint8Array, encoded: Uint8Array<ArrayBuffer>, width: number, height: number): Uint8Array<ArrayBuffer> {
    const extra = webpChunks(original).filter(chunk => !IMAGE_CHUNKS.has(chunk.type));
    const encodedChunks = webpChunks(encoded);
    const image = encodedChunks.filter(chunk => chunk.type === "ALPH" || chunk.type === "VP8 " || chunk.type === "VP8L");
    if (!extra.length) {
        if (!encodedChunks.some(chunk => !IMAGE_CHUNKS.has(chunk.type))) return encoded;
        // Only the encoder's own additions to drop: a lone VP8 or VP8L chunk is a complete simple-format file.
        if (image.length === 1) return riffFile([riffChunk(image[0].type, image[0].data)]);
    }
    const lossless = image.find(chunk => chunk.type === "VP8L");
    const alpha = image.some(chunk => chunk.type === "ALPH")
        || Boolean(lossless && lossless.data.length >= 5 && (lossless.data[4] & 0x10));
    const icc = extra.filter(chunk => chunk.type === "ICCP");
    const exif = extra.filter(chunk => chunk.type === "EXIF");
    const xmp = extra.filter(chunk => chunk.type === "XMP ");
    const other = extra.filter(chunk => !["ICCP", "EXIF", "XMP "].includes(chunk.type));
    const header = new Uint8Array(10);
    header[0] = (icc.length ? 0x20 : 0) | (alpha ? 0x10 : 0) | (exif.length ? 0x08 : 0) | (xmp.length ? 0x04 : 0);
    header.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff], 4);
    header.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 7);
    return riffFile([
        riffChunk("VP8X", header),
        ...[...icc, ...image, ...exif, ...xmp, ...other].map(chunk => riffChunk(chunk.type, chunk.data)),
    ]);
}
