/**
 * Opacity maps for the sparkle, built from the calibrated captures in masks.ts.
 *
 * A capture shows the logo over pure black, so each pixel's brightest channel
 * divided by 255 is the logo's opacity there. The captures also carry faint
 * speckle (values up to about 6 of 255) scattered over the black, which is
 * noise from the capture rather than part of the logo. Only the logo's own
 * footprint is kept: pixels of 10 or more and a 2-pixel band around them,
 * where the anti-aliased edge fades out. Everything else in the box is left
 * exactly as it is.
 *
 * alphaFor resamples a capture to another whole-pixel size; placedAlpha draws
 * it at a fractional position and scale, as a picture scaled down from one of
 * Gemini's standard sizes shows it. Maps carry the capture's own opacity; the
 * fitted strength is applied where they are used (detect.ts).
 */
import { MASK_SOURCES, type MaskId } from "./masks";
import { decodePng } from "./png";

export interface AlphaMap {
    width: number;
    height: number;
    /** Opacity from 0 to 1, row after row. */
    values: Float32Array;
}

const CORE = 10;
const BAND = 2;

function base64Bytes(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** The capture's own pixel values, 0 to 255: the brightest channel of each pixel. */
export function captureValues(id: MaskId): { size: number; values: Uint8Array } {
    const { size, png } = MASK_SOURCES[id];
    const image = decodePng(base64Bytes(png));
    if (image.width !== size || image.height !== size) throw new Error(`Mask ${id} is not ${size} × ${size}.`);
    const values = new Uint8Array(size * size);
    for (let i = 0; i < values.length; i++) {
        values[i] = Math.max(image.rgba[i * 4], image.rgba[i * 4 + 1], image.rgba[i * 4 + 2]);
    }
    return { size, values };
}

const bases = new Map<MaskId, AlphaMap>();

export function baseAlpha(id: MaskId): AlphaMap {
    const cached = bases.get(id);
    if (cached) return cached;
    const { size, values } = captureValues(id);
    const alpha = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let nearLogo = false;
            for (let dy = -BAND; dy <= BAND && !nearLogo; dy++) {
                for (let dx = -BAND; dx <= BAND; dx++) {
                    const yy = y + dy, xx = x + dx;
                    if (yy >= 0 && yy < size && xx >= 0 && xx < size && values[yy * size + xx] >= CORE) { nearLogo = true; break; }
                }
            }
            if (nearLogo) alpha[y * size + x] = values[y * size + x] / 255;
        }
    }
    const map = { width: size, height: size, values: alpha };
    bases.set(id, map);
    return map;
}

/** One axis of an area-average (shrinking) or linear (enlarging) resample. */
function resampleAxis(source: Float32Array, from: number, to: number, lines: number, horizontal: boolean): Float32Array {
    const out = new Float32Array(horizontal ? to * lines : lines * to);
    const read = (line: number, i: number) => horizontal ? source[line * from + i] : source[i * lines + line];
    const write = (line: number, i: number, value: number) => {
        if (horizontal) out[line * to + i] = value; else out[i * lines + line] = value;
    };
    const ratio = from / to;
    for (let line = 0; line < lines; line++) {
        for (let i = 0; i < to; i++) {
            let value: number;
            if (to < from) {
                const start = i * ratio, end = (i + 1) * ratio;
                let sum = 0;
                for (let s = Math.floor(start); s < Math.ceil(end); s++) {
                    const overlap = Math.min(end, s + 1) - Math.max(start, s);
                    if (overlap > 0) sum += read(line, s) * overlap;
                }
                value = sum / ratio;
            } else {
                const centre = Math.min(Math.max((i + 0.5) * ratio - 0.5, 0), from - 1);
                const left = Math.floor(centre), right = Math.min(left + 1, from - 1);
                const t = centre - left;
                value = read(line, left) * (1 - t) + read(line, right) * t;
            }
            write(line, i, value);
        }
    }
    return out;
}

const cache = new Map<string, AlphaMap>();

function remember(key: string, make: () => AlphaMap): AlphaMap {
    let map = cache.get(key);
    if (!map) {
        // A search tries a few hundred variants per image; keep the cache from growing without bound.
        if (cache.size > 2000) cache.clear();
        map = make();
        cache.set(key, map);
    }
    return map;
}

/** The map for a logo of `size` × `size` pixels, resampled from the capture when the sizes differ. */
export function alphaFor(id: MaskId, size: number): AlphaMap {
    const base = baseAlpha(id);
    if (size === base.width) return base;
    return remember(`${id}@${size}`, () => {
        const rows = resampleAxis(base.values, base.width, size, base.height, true);
        return { width: size, height: size, values: resampleAxis(rows, base.height, size, size, false) };
    });
}

/** The capture pixels one output pixel covers along an axis: the first one's index and each one's share. */
interface Span {
    first: number;
    weights: number[];
}

/**
 * Area weights for one axis, with capture pixel p spanning
 * [origin + p·scale, origin + (p + 1)·scale) and output pixel i spanning [i, i + 1).
 */
function axisSpans(sourceSize: number, scale: number, origin: number, outSize: number): Span[] {
    const spans: Span[] = [];
    for (let i = 0; i < outSize; i++) {
        const first = Math.max(0, Math.floor((i - origin) / scale));
        const last = Math.min(sourceSize - 1, Math.floor((i + 1 - origin) / scale));
        const weights: number[] = [];
        for (let p = first; p <= last; p++) {
            const lo = origin + p * scale;
            weights.push(Math.max(0, Math.min(i + 1, lo + scale) - Math.max(i, lo)));
        }
        spans.push({ first, weights });
    }
    return spans;
}

export interface Placed {
    map: AlphaMap;
    /** The integer box that holds the logo. */
    x: number;
    y: number;
}

/**
 * The capture drawn at a fractional position and scale, as an image of the
 * same picture scaled down from a standard size would show it: each output
 * pixel gets the capture's opacity averaged over the area it covers.
 */
export function placedAlpha(id: MaskId, left: number, top: number, scaleX: number, scaleY: number): Placed {
    const base = baseAlpha(id);
    const x = Math.floor(left + 1e-9), y = Math.floor(top + 1e-9);
    const width = Math.ceil(left + base.width * scaleX - 1e-9) - x;
    const height = Math.ceil(top + base.height * scaleY - 1e-9) - y;
    const key = `${id}:${(left - x).toFixed(3)}:${(top - y).toFixed(3)}:${scaleX.toFixed(5)}:${scaleY.toFixed(5)}`;
    const map = remember(key, () => {
        const spansX = axisSpans(base.width, scaleX, left - x, width);
        const spansY = axisSpans(base.height, scaleY, top - y, height);
        // Down the rows first (height × capture width), then across.
        const rows = new Float32Array(height * base.width);
        for (let j = 0; j < height; j++) {
            const { first, weights } = spansY[j];
            for (let k = 0; k < weights.length; k++) {
                const w = weights[k], q = first + k;
                for (let p = 0; p < base.width; p++) rows[j * base.width + p] += w * base.values[q * base.width + p];
            }
        }
        const values = new Float32Array(width * height);
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const { first, weights } = spansX[i];
                let sum = 0;
                for (let k = 0; k < weights.length; k++) sum += weights[k] * rows[j * base.width + first + k];
                values[j * width + i] = sum;
            }
        }
        return { width, height, values };
    });
    return { map, x, y };
}
