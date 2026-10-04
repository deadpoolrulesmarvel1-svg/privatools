/**
 * Images for Markdown to Word: only those carried inside the Markdown itself,
 * as data: URIs, are put in the document. An image at a web address is
 * never requested, since that would send a request the visitor did not ask
 * for; it is left out and reported by name, and its alt text stays in the
 * document.
 */

export type ImageFormat = "png" | "jpeg" | "gif";

export interface EmbeddedImage {
    bytes: Uint8Array;
    format: ImageFormat;
    /** Pixels, from the image's own header. */
    width: number;
    height: number;
}

export type ImageSource =
    | { ok: true; image: EmbeddedImage }
    | { ok: false; reason: string };

/** Decoded images larger than this are left out: a Word document is not the place for them. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const SIGNATURES: { format: ImageFormat; bytes: number[] }[] = [
    { format: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { format: "jpeg", bytes: [0xff, 0xd8, 0xff] },
    { format: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

function sniff(bytes: Uint8Array): ImageFormat | null {
    return SIGNATURES.find(signature => signature.bytes.every((value, index) => bytes[index] === value))?.format ?? null;
}

/** Width and height from a PNG, JPEG or GIF header, or null when the header can't be read. */
export function imageSize(bytes: Uint8Array, format: ImageFormat): { width: number; height: number } | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (format === "png") {
        if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
        return valid(view.getUint32(16), view.getUint32(20));
    }
    if (format === "gif") {
        if (bytes.length < 10) return null;
        return valid(view.getUint16(6, true), view.getUint16(8, true));
    }
    // JPEG: walk the segments to the frame header (SOF0–SOF15, except DHT, JPG and DAC).
    let at = 2;
    while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff) { at++; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
        if (marker === 0xd9 || marker === 0xda) return null;
        const length = view.getUint16(at + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return valid(view.getUint16(at + 7), view.getUint16(at + 5));
        }
        if (length < 2) return null;
        at += 2 + length;
    }
    return null;
}

function valid(width: number, height: number): { width: number; height: number } | null {
    return width > 0 && height > 0 && width <= 100000 && height <= 100000 ? { width, height } : null;
}

function decodeBase64(data: string): Uint8Array | null {
    const clean = data.replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || !clean.length) return null;
    const padded = clean.length % 4 ? clean + "=".repeat(4 - (clean.length % 4)) : clean;
    try {
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

const FORMAT_NAMES: Record<string, string> = { "image/svg+xml": "SVG", "image/webp": "WebP", "image/avif": "AVIF", "image/bmp": "BMP", "image/tiff": "TIFF", "image/heic": "HEIC" };

/**
 * What an image's address gives the document. Only a data: URI holding a
 * PNG, JPEG or GIF is read; anything else is left out, with the reason.
 * Nothing here makes a request.
 */
export function readImageSource(src: string): ImageSource {
    const address = src.trim();
    if (!address) return { ok: false, reason: "it has no address" };
    if (/^https?:\/\//i.test(address) || address.startsWith("//")) return { ok: false, reason: "it is at a web address, and images are never downloaded" };
    if (!/^data:/i.test(address)) return { ok: false, reason: "it is a file that isn’t in the Markdown" };
    const comma = address.indexOf(",");
    if (comma < 0) return { ok: false, reason: "its data couldn’t be read" };
    const header = address.slice(5, comma).toLowerCase();
    const mime = header.split(";")[0].trim();
    if (!header.split(";").some(part => part.trim() === "base64")) {
        return { ok: false, reason: mime === "image/svg+xml" ? "SVG images aren’t supported; PNG, JPEG and GIF are" : "its data couldn’t be read" };
    }
    const bytes = decodeBase64(address.slice(comma + 1));
    if (!bytes) return { ok: false, reason: "its data couldn’t be read" };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "it is larger than 20 MB" };
    const format = sniff(bytes);
    if (!format) {
        const named = FORMAT_NAMES[mime];
        return { ok: false, reason: named ? `${named} images aren’t supported; PNG, JPEG and GIF are` : "it isn’t a PNG, JPEG or GIF image" };
    }
    const size = imageSize(bytes, format);
    if (!size) return { ok: false, reason: "its data couldn’t be read" };
    return { ok: true, image: { bytes, format, ...size } };
}

/** What to call an image in the result: its file name, its alt text, or its line. */
export function imageName(src: string, alt: string, line: number): string {
    const address = src.trim();
    if (!/^data:/i.test(address)) {
        // The last part of the path, never the scheme or the host.
        const path = address.split(/[?#]/)[0].replace(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/]*/, "");
        const last = path.split("/").filter(Boolean).pop() ?? "";
        let name = last;
        try { name = decodeURIComponent(last); } catch { /* keep it as written */ }
        if (name && !/^(https?:|www\.)/i.test(name) && name.length <= 80) return name;
    }
    const text = alt.replace(/\s+/g, " ").trim();
    if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
    return `The image on line ${line}`;
}
