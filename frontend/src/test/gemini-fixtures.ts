/**
 * Neutral synthetic pictures for the Gemini sparkle remover's tests: flat
 * colours, gradients, noise and a photo-like texture, plus white shapes to
 * put in the corner. Nothing here comes from a real photo or a real Gemini
 * image; the watermark is applied with the same blend Gemini uses.
 */
import { zlibSync } from "fflate";
import type { AlphaMap } from "@/lib/gemini-watermark/alpha";
import type { RgbaImage } from "@/lib/gemini-watermark/detect";
import { crc32 } from "@/lib/zip";

/** Small deterministic generator (mulberry32), so every run draws the same pictures. */
export function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function blank(width: number, height: number): RgbaImage {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function fill(width: number, height: number, colour: (x: number, y: number) => [number, number, number]): RgbaImage {
    const image = blank(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = colour(x, y);
            const i = (y * width + x) * 4;
            image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
        }
    }
    return image;
}

/** Smooth value noise in 0–1: bilinear interpolation of a random lattice, a few octaves. */
function valueNoise(width: number, height: number, seed: number, cell: number, octaves: number): Float32Array {
    const out = new Float32Array(width * height);
    const next = random(seed);
    let amplitude = 1, total = 0;
    for (let octave = 0; octave < octaves; octave++) {
        const step = Math.max(2, cell >> octave);
        const cols = Math.ceil(width / step) + 2, rows = Math.ceil(height / step) + 2;
        const lattice = Float32Array.from({ length: cols * rows }, () => next());
        for (let y = 0; y < height; y++) {
            const gy = y / step, y0 = Math.floor(gy), ty = gy - y0;
            const sy = ty * ty * (3 - 2 * ty);
            for (let x = 0; x < width; x++) {
                const gx = x / step, x0 = Math.floor(gx), tx = gx - x0;
                const sx = tx * tx * (3 - 2 * tx);
                const a = lattice[y0 * cols + x0], b = lattice[y0 * cols + x0 + 1];
                const c = lattice[(y0 + 1) * cols + x0], d = lattice[(y0 + 1) * cols + x0 + 1];
                out[y * width + x] += amplitude * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
            }
        }
        total += amplitude;
        amplitude /= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

export type Background = "flat-navy" | "flat-orange" | "flat-grey" | "flat-black" | "flat-pale" | "gradient" | "noise" | "photo";

export const BACKGROUNDS: Background[] = ["flat-navy", "flat-orange", "flat-grey", "flat-black", "flat-pale", "gradient", "noise", "photo"];

export function background(kind: Background, width: number, height: number, seed = 1): RgbaImage {
    switch (kind) {
        case "flat-navy": return fill(width, height, () => [24, 36, 92]);
        case "flat-orange": return fill(width, height, () => [232, 118, 24]);
        case "flat-grey": return fill(width, height, () => [128, 128, 128]);
        case "flat-black": return fill(width, height, () => [0, 0, 0]);
        case "flat-pale": return fill(width, height, () => [226, 230, 236]);
        case "gradient": return fill(width, height, (x, y) => [
            Math.round(20 + (200 * x) / width), Math.round(40 + (160 * y) / height), Math.round(220 - (180 * (x + y)) / (width + height)),
        ]);
        case "noise": {
            // Mid-tone base with strong per-pixel grain (standard deviation about 12 levels).
            const next = random(seed);
            const gauss = () => (next() + next() + next() + next() - 2) * 20.8;
            return fill(width, height, () => [110 + gauss(), 124 + gauss(), 98 + gauss()].map(v => Math.round(Math.min(255, Math.max(0, v)))) as [number, number, number]);
        }
        case "photo": {
            // A soft landscape-like texture: large smooth shapes, detail on top, and light grain.
            const coarse = valueNoise(width, height, seed, 96, 5);
            const tint = valueNoise(width, height, seed + 7, 64, 3);
            const next = random(seed + 13);
            return fill(width, height, (x, y) => {
                const i = y * width + x, grain = (next() - 0.5) * 10;
                const v = coarse[i], t = tint[i];
                return [40 + 170 * v + grain, 60 + 120 * t + 40 * v + grain, 90 + 110 * (1 - v) + grain].map(c => Math.round(Math.min(255, Math.max(0, c)))) as [number, number, number];
            });
        }
    }
}

export function clone(image: RgbaImage): RgbaImage {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/**
 * Lay the logo over the picture the way Gemini does: alpha · 255 + (1 − alpha) · pixel,
 * rounded to 8 bits, with the map's opacity times `gain`.
 */
export function applySparkle(image: RgbaImage, alpha: AlphaMap, x0: number, y0: number, gain = 1): RgbaImage {
    const out = clone(image);
    const { width, height, values } = alpha;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const a = Math.min(0.99, values[y * width + x] * gain);
            if (a <= 0) continue;
            const i = ((y0 + y) * image.width + x0 + x) * 4;
            for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(a * 255 + (1 - a) * image.data[i + c]);
        }
    }
    return out;
}

export type Shape = "square" | "circle" | "star" | "big-star" | "text" | "glow" | "ring";

export const SHAPES: Shape[] = ["square", "circle", "star", "big-star", "text", "glow", "ring"];

/** Coverage of a shape in 0–1 at a point, for shapes centred in the box (cx, cy) with half-size r. */
function inside(shape: Shape, px: number, py: number, cx: number, cy: number, r: number): number {
    const dx = px - cx, dy = py - cy;
    switch (shape) {
        case "square": return Math.abs(dx) <= r * 0.6 && Math.abs(dy) <= r * 0.6 ? 1 : 0;
        case "circle": return dx * dx + dy * dy <= (r * 0.7) ** 2 ? 1 : 0;
        case "star":
        case "big-star": {
            // Four-pointed star made of two thin diamonds, drawn fully opaque.
            const reach = shape === "star" ? r : r * 1.4, waist = shape === "star" ? r * 0.25 : r * 0.33;
            const diamond = (u: number, v: number) => Math.abs(u) / reach + Math.abs(v) / waist <= 1;
            return diamond(dx, dy) || diamond(dy, dx) ? 1 : 0;
        }
        case "text": {
            // Four vertical strokes, like white lettering over the corner.
            const column = Math.floor((dx + r) / (r / 2));
            const within = (dx + r) % (r / 2);
            return column >= 0 && column < 4 && within < r / 5 && Math.abs(dy) <= r * 0.45 ? 1 : 0;
        }
        case "ring": {
            const d = Math.sqrt(dx * dx + dy * dy);
            return d <= r && d >= r * 0.85 ? 1 : 0;
        }
        case "glow": return Math.exp(-(dx * dx + dy * dy) / (r * 0.7) ** 2);
    }
}

/** Paint an opaque white (or near-white) shape centred on the logo box, anti-aliased by 4 × 4 supersampling. */
export function paintShape(image: RgbaImage, shape: Shape, x0: number, y0: number, size: number, white = 255): RgbaImage {
    const out = clone(image);
    const cx = x0 + size / 2, cy = y0 + size / 2, r = size / 2;
    const from = Math.max(0, Math.floor(x0 - size * 0.5)), to = Math.min(image.width, Math.ceil(x0 + size * 1.5));
    const top = Math.max(0, Math.floor(y0 - size * 0.5)), bottom = Math.min(image.height, Math.ceil(y0 + size * 1.5));
    for (let y = top; y < bottom; y++) {
        for (let x = from; x < to; x++) {
            let cover = 0;
            if (shape === "glow") cover = inside(shape, x + 0.5, y + 0.5, cx, cy, r);
            else {
                for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) cover += inside(shape, x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, cx, cy, r);
                cover /= 16;
            }
            if (cover <= 0) continue;
            const i = (y * image.width + x) * 4;
            for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(cover * white + (1 - cover) * image.data[i + c]);
        }
    }
    return out;
}

/** A see-through white square laid over the whole logo box and around it, like a caption panel. */
export function veil(image: RgbaImage, x0: number, y0: number, size: number, opacity: number): RgbaImage {
    const out = clone(image);
    const from = Math.max(0, x0 - Math.round(size / 3)), to = Math.min(image.width, x0 + size + Math.round(size / 3));
    const top = Math.max(0, y0 - Math.round(size / 3)), bottom = Math.min(image.height, y0 + size + Math.round(size / 3));
    for (let y = top; y < bottom; y++) {
        for (let x = from; x < to; x++) {
            const i = (y * image.width + x) * 4;
            for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(opacity * 255 + (1 - opacity) * image.data[i + c]);
        }
    }
    return out;
}

/** A soft white glow centred on the logo box and spreading well beyond it, like a light source or glare. */
export function glare(image: RgbaImage, x0: number, y0: number, size: number): RgbaImage {
    const out = clone(image);
    const cx = x0 + size / 2, cy = y0 + size / 2, r = size / 3;
    for (let y = Math.max(0, y0 - size); y < Math.min(image.height, y0 + 2 * size); y++) {
        for (let x = Math.max(0, x0 - size); x < Math.min(image.width, x0 + 2 * size); x++) {
            const k = 0.85 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
            const i = (y * image.width + x) * 4;
            for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(image.data[i + c] * (1 - k) + 255 * k);
        }
    }
    return out;
}

// ── PNG files built by hand, independently of the code under test ─────────

export const ascii = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0));

export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(ascii(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
}

export interface PngSpec {
    width: number;
    height: number;
    colorType: number;
    bitDepth?: number;
    /** Packed scanlines, without filter bytes. */
    pixels: Uint8Array;
    /** Row filter: one of 0–4, or "cycle" to use each in turn. */
    filter?: number | "cycle";
    interlace?: number;
    /** Chunks written before and after the image data, as [type, data]. */
    before?: [string, Uint8Array][];
    after?: [string, Uint8Array][];
    /** Split the compressed data into IDAT chunks of this many bytes. */
    idatSize?: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function buildPng(spec: PngSpec): Uint8Array<ArrayBuffer> {
    const bitDepth = spec.bitDepth ?? 8;
    const rowBytes = Math.ceil((spec.width * CHANNELS[spec.colorType] * bitDepth) / 8);
    const bpp = Math.max(1, (CHANNELS[spec.colorType] * bitDepth) >> 3);
    const filtered = new Uint8Array((rowBytes + 1) * spec.height);
    for (let y = 0; y < spec.height; y++) {
        const filter = spec.filter === "cycle" ? y % 5 : spec.filter ?? 0;
        filtered[y * (rowBytes + 1)] = filter;
        for (let x = 0; x < rowBytes; x++) {
            const value = spec.pixels[y * rowBytes + x];
            const left = x >= bpp ? spec.pixels[y * rowBytes + x - bpp] : 0;
            const up = y > 0 ? spec.pixels[(y - 1) * rowBytes + x] : 0;
            const upLeft = y > 0 && x >= bpp ? spec.pixels[(y - 1) * rowBytes + x - bpp] : 0;
            const predicted = [0, left, up, (left + up) >> 1, paethPredictor(left, up, upLeft)][filter];
            filtered[y * (rowBytes + 1) + 1 + x] = (value - predicted) & 0xff;
        }
    }
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, spec.width);
    new DataView(header.buffer).setUint32(4, spec.height);
    header.set([bitDepth, spec.colorType, 0, 0, spec.interlace ?? 0], 8);
    const compressed = zlibSync(filtered);
    const size = spec.idatSize ?? compressed.length;
    const idat: Uint8Array[] = [];
    for (let at = 0; at < compressed.length; at += size) idat.push(pngChunk("IDAT", compressed.subarray(at, at + size)));
    return concatBytes([
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        pngChunk("IHDR", header),
        ...(spec.before ?? []).map(([type, data]) => pngChunk(type, data)),
        ...idat,
        ...(spec.after ?? []).map(([type, data]) => pngChunk(type, data)),
        pngChunk("IEND", new Uint8Array(0)),
    ]);
}

/** An 8-bit RGB (or RGBA) PNG of the picture, with optional extra chunks. */
export function pictureToPng(image: RgbaImage, extra: Pick<PngSpec, "before" | "after"> & { alpha?: boolean } = {}): Uint8Array<ArrayBuffer> {
    const channels = extra.alpha ? 4 : 3;
    const pixels = new Uint8Array(image.width * image.height * channels);
    for (let i = 0; i < image.width * image.height; i++) {
        for (let c = 0; c < channels; c++) pixels[i * channels + c] = image.data[i * 4 + c];
    }
    return buildPng({ width: image.width, height: image.height, colorType: extra.alpha ? 6 : 2, pixels, filter: "cycle", before: extra.before, after: extra.after });
}

/** Largest per-channel difference between two images of the same size, and how many pixels differ at all. */
export function difference(a: RgbaImage, b: RgbaImage): { max: number; changed: number } {
    let max = 0, changed = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        let pixel = 0;
        for (let c = 0; c < 4; c++) pixel = Math.max(pixel, Math.abs(a.data[i + c] - b.data[i + c]));
        max = Math.max(max, pixel);
        if (pixel) changed++;
    }
    return { max, changed };
}
