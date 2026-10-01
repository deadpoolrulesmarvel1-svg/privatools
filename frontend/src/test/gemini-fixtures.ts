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

/** A picture of one flat colour. */
export function solid(width: number, height: number, [r, g, b]: [number, number, number]): RgbaImage {
    return fill(width, height, () => [r, g, b]);
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

export type Smooth = "shading" | "bokeh" | "clouds";

export const SMOOTH: Smooth[] = ["shading", "bokeh", "clouds"];

/**
 * Smooth pictures that vary slowly, where a remnant shows most once the
 * colour is not flat: soft shading with gentle curvature, out-of-focus light
 * (overlapping soft discs 10 to 34 px across, about the logo's size, blurred
 * as a lens would), and low-frequency clouds of about ±20 levels over 64 px.
 * Each carries a fine grain of about 1 level.
 */
export function smooth(kind: Smooth, width: number, height: number, seed = 1): RgbaImage {
    const next = random(seed + 101);
    const grain = () => (next() + next() + next() - 1.5) * 2;
    const clamp = (values: number[]) => values.map(v => Math.round(Math.min(255, Math.max(0, v)))) as [number, number, number];
    switch (kind) {
        case "shading": return fill(width, height, (x, y) => {
            const u = x / width, v = y / height;
            return clamp([120 + 50 * u - 30 * v * v + grain(), 140 - 40 * u * v + 25 * Math.sin(3 * u) + grain(), 90 + 40 * v + 20 * Math.cos(2.5 * u) + grain()]);
        });
        case "bokeh": {
            const place = random(seed + 202);
            const discs = Array.from({ length: 60 }, () => ({
                x: place() * width, y: place() * height, radius: 14 * (0.6 + 0.8 * place()),
                colour: [place(), place(), place()].map(v => (v - 0.5) * 80),
            }));
            const sharp = fill(width, height, (x, y) => {
                const c = [70, 95, 55];
                for (const d of discs) {
                    const t = Math.hypot(x - d.x, y - d.y) / d.radius;
                    const weight = t < 0.8 ? 1 : t < 1.2 ? (1.2 - t) / 0.4 : 0;
                    for (let k = 0; k < 3; k++) c[k] += weight * d.colour[k];
                }
                return clamp([c[0] + grain(), c[1] + grain(), c[2] + grain()]);
            });
            // A lens's blur (a 7 px box, twice), then the sensor's grain on top.
            const out = boxBlur(boxBlur(sharp, 3), 3);
            for (let i = 0; i < width * height; i++) {
                for (let k = 0; k < 3; k++) out.data[i * 4 + k] = Math.min(255, Math.max(0, out.data[i * 4 + k] + Math.round(grain() * 0.75)));
            }
            return out;
        }
        case "clouds": {
            const planes = [0, 1, 2].map(k => valueNoise(width, height, seed + 17 * k, 64, 2));
            return fill(width, height, (x, y) => {
                const i = y * width + x;
                return clamp([150 + 40 * (planes[0][i] - 0.5) + grain(), 120 + 40 * (planes[1][i] - 0.5) + grain(), 100 + 40 * (planes[2][i] - 0.5) + grain()]);
            });
        }
    }
}

export function clone(image: RgbaImage): RgbaImage {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/** A box blur `radius` pixels either way, edges repeated, alpha kept. */
function boxBlur(image: RgbaImage, radius: number): RgbaImage {
    const { width, height, data } = image;
    const out = clone(image);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let k = 0; k < 3; k++) {
                let sum = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const xx = Math.min(width - 1, Math.max(0, x + dx)), yy = Math.min(height - 1, Math.max(0, y + dy));
                        sum += data[(yy * width + xx) * 4 + k];
                    }
                }
                out.data[(y * width + x) * 4 + k] = Math.round(sum / (2 * radius + 1) ** 2);
            }
        }
    }
    return out;
}

/**
 * Lay the logo over the picture the way Gemini does: alpha · 255 + (1 − alpha) · pixel,
 * rounded to 8 bits, with the map's opacity times `gain`. Slightly negative opacity (a
 * Lanczos-scaled map's overshoot) darkens the pixel, as the scaling would have.
 */
export function applySparkle(image: RgbaImage, alpha: AlphaMap, x0: number, y0: number, gain = 1): RgbaImage {
    const out = clone(image);
    const { width, height, values } = alpha;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const a = Math.min(0.99, values[y * width + x] * gain);
            if (a === 0) continue;
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

// ── Degraded copies: what an app does to an image after Gemini saved it ────

/** The example quantisation tables of the JPEG standard (ITU T.81, Annex K), in row order. */
const LUMA_TABLE = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_TABLE = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
    ...Array<number>(32).fill(99),
];

/** A table scaled for a quality from 1 to 100, the way libjpeg scales it. */
function qualityTable(base: number[], quality: number): number[] {
    const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
    return base.map(value => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))));
}

const DCT = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) / 2));

/** Transform, quantise and transform back one plane in 8 × 8 blocks, in place (values level-shifted by 128). */
function quantisePlane(plane: Float64Array, width: number, height: number, table: number[]): void {
    const block = new Float64Array(64), rows = new Float64Array(64), coefficients = new Float64Array(64);
    for (let by = 0; by < height; by += 8) {
        for (let bx = 0; bx < width; bx += 8) {
            // Edge blocks repeat the last row and column, as encoders pad them.
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                block[y * 8 + x] = plane[Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)] - 128;
            }
            for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
                let sum = 0;
                for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * DCT[x][u];
                rows[y * 8 + u] = sum;
            }
            for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
                let sum = 0;
                for (let y = 0; y < 8; y++) sum += rows[y * 8 + u] * DCT[y][v];
                const step = table[v * 8 + u];
                coefficients[v * 8 + u] = Math.round(sum / step) * step;
            }
            for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) {
                let sum = 0;
                for (let u = 0; u < 8; u++) sum += coefficients[v * 8 + u] * DCT[x][u];
                rows[v * 8 + x] = sum;
            }
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                if (by + y >= height || bx + x >= width) continue;
                let sum = 0;
                for (let v = 0; v < 8; v++) sum += rows[v * 8 + x] * DCT[y][v];
                plane[(by + y) * width + bx + x] = sum + 128;
            }
        }
    }
}

/**
 * The picture as a baseline JPEG at this quality would give it back: YCbCr
 * with 4:2:0 chroma, 8 × 8 blocks quantised with the standard's example
 * tables. Entropy coding is lossless, so it is left out.
 */
export function jpegLike(image: RgbaImage, quality: number): RgbaImage {
    const { width, height, data } = image;
    const luma = new Float64Array(width * height);
    const halfWidth = Math.ceil(width / 2), halfHeight = Math.ceil(height / 2);
    const cb = new Float64Array(halfWidth * halfHeight), cr = new Float64Array(halfWidth * halfHeight), count = new Float64Array(halfWidth * halfHeight);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
            luma[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
            const j = (y >> 1) * halfWidth + (x >> 1);
            cb[j] += -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
            cr[j] += 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
            count[j]++;
        }
    }
    for (let j = 0; j < cb.length; j++) { cb[j] /= count[j]; cr[j] /= count[j]; }
    quantisePlane(luma, width, height, qualityTable(LUMA_TABLE, quality));
    const chroma = qualityTable(CHROMA_TABLE, quality);
    quantisePlane(cb, halfWidth, halfHeight, chroma);
    quantisePlane(cr, halfWidth, halfHeight, chroma);
    const out = clone(image);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4, j = (y >> 1) * halfWidth + (x >> 1);
            const lum = luma[y * width + x], blue = cb[j] - 128, red = cr[j] - 128;
            out.data[i] = Math.round(lum + 1.402 * red);
            out.data[i + 1] = Math.round(lum - 0.344136 * blue - 0.714136 * red);
            out.data[i + 2] = Math.round(lum + 1.772 * blue);
        }
    }
    return out;
}

const sinc = (x: number) => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
const KERNELS = {
    /** Linear interpolation: soft, no overshoot. */
    triangle: { radius: 1, weight: (x: number) => Math.max(0, 1 - Math.abs(x)) },
    /** Lanczos with three lobes, what most editors offer as their sharpest: it overshoots at edges. */
    lanczos: { radius: 3, weight: (x: number) => Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0 },
};

/** The picture scaled by `factor`, with the filter widened to cover every source pixel when it shrinks, as image editors scale. */
export function resized(image: RgbaImage, factor: number, filter: keyof typeof KERNELS = "triangle"): RgbaImage {
    const width = Math.round(image.width * factor), height = Math.round(image.height * factor);
    const out = blank(width, height);
    const { radius, weight } = KERNELS[filter];
    const stretch = Math.max(1, 1 / factor), support = radius * stretch;
    const weights = (size: number, source: number) => Array.from({ length: size }, (_, i) => {
        const centre = (i + 0.5) / factor - 0.5;
        const taps: [number, number][] = [];
        for (let s = Math.floor(centre - support); s <= Math.ceil(centre + support); s++) {
            const w = weight((s - centre) / stretch);
            if (w !== 0) taps.push([Math.min(source - 1, Math.max(0, s)), w]);
        }
        const total = taps.reduce((sum, [, w]) => sum + w, 0);
        return taps.map(([s, w]) => [s, w / total] as [number, number]);
    });
    const across = weights(width, image.width), down = weights(height, image.height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                for (const [sy, wy] of down[y]) for (const [sx, wx] of across[x]) sum += wy * wx * image.data[(sy * image.width + sx) * 4 + c];
                out.data[o + c] = Math.round(sum);
            }
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
