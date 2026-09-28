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
 */
import { MASK_SOURCES, type MaskId } from "./masks";
import { decodePng } from "./png";

export interface AlphaMap {
    size: number;
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
    const map = { size, values: alpha };
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

const sized = new Map<string, AlphaMap>();

/** The map for a logo of `size` pixels, resampled from the capture when the sizes differ. */
export function alphaFor(id: MaskId, size: number): AlphaMap {
    const base = baseAlpha(id);
    if (size === base.size) return base;
    const key = `${id}@${size}`;
    const cached = sized.get(key);
    if (cached) return cached;
    const rows = resampleAxis(base.values, base.size, size, base.size, true);
    const values = resampleAxis(rows, base.size, size, size, false);
    const map = { size, values };
    sized.set(key, map);
    return map;
}
