/**
 * Where Gemini puts its visible sparkle, by image size.
 *
 * The rules come from the two projects that measured the logo
 * (github.com/allenk/GeminiWatermarkTool and
 * github.com/GargantuaX/gemini-watermark-remover), checked against real
 * Gemini images. Each one is only a place to look: detect.ts decides whether
 * the logo is really there, and how well it fits.
 *
 * - 48 px, 32 px from the right and bottom edges, at the logo's full
 *   calibrated opacity, on images with a side of 1024 px or less.
 * - 96 px, 64 px in, on images with both sides over 1024 px.
 * - 96 px, 192 px in, with the paler capture from May 2026, on large images.
 * - 48 px, 96 px in, at about 0.6 of the 48 px capture's opacity: what
 *   current Gemini images at the standard 1K sizes carry (1024 × 1024,
 *   848 × 1264, the free tier's 1376 × 768 and the rest), as well as
 *   2048 × 2048, 2400 × 1792 and sizes Gemini does not make. On a picture
 *   scaled from a standard 1K size (1024 × 768 from 1200 × 896, say) the same
 *   logo is looked for at the scaled position and size, to a fraction of a
 *   pixel.
 * - A 36 px logo whose margin follows the picture's proportions, or a larger
 *   scaled one, as AllenK's tool describes for Gemini 3.5's smaller images.
 */
import { MASK_SOURCES, type MaskId } from "./masks";

export type Family = "corner-32" | "corner-64" | "corner-192" | "inset-96" | "proportional";

export interface Placement {
    family: Family;
    mask: MaskId;
    /** The logo's opacity as a multiple of the capture's. */
    gain: number;
    /** The logo's top-left corner in the picture; fractional when it was scaled from a standard size. */
    left: number;
    top: number;
    /** Picture pixels per capture pixel, across and down. */
    scaleX: number;
    scaleY: number;
    /** Whole-pixel search: up to this many pixels either way. */
    search: number;
    /** Logo size search, in pixels either way, keeping the margins (native placements only). */
    sizeSearch: number;
    /** Fractional search of the position, for a placement scaled from a standard size. */
    subpixel: boolean;
}

/** Gemini's standard output sizes [width, height], from GargantuaX's size catalogue (commit 1319561). */
const SIZES_3X_05K: [number, number][] = [[512, 512], [256, 1024], [192, 1536], [424, 632], [632, 424], [448, 600], [1024, 256], [600, 448], [464, 576], [576, 464], [1536, 192], [384, 688], [688, 384], [792, 168]];
const SIZES_3X_1K: [number, number][] = [[1024, 1024], [512, 2048], [384, 3072], [848, 1264], [1264, 848], [896, 1200], [2048, 512], [1200, 896], [928, 1152], [1152, 928], [3072, 384], [768, 1376], [1376, 768], [1408, 768], [1584, 672]];
const SIZES_3X_2K: [number, number][] = [[2048, 2048], [1024, 4096], [768, 6144], [1696, 2528], [2528, 1696], [1792, 2400], [4096, 1024], [2400, 1792], [1856, 2304], [2304, 1856], [6144, 768], [1536, 2752], [2752, 1536], [3168, 1344], [2816, 1536]];
const SIZES_3X_4K: [number, number][] = [[4096, 4096], [2048, 8192], [1536, 12288], [3392, 5056], [5056, 3392], [3584, 4800], [8192, 2048], [4800, 3584], [3712, 4608], [4608, 3712], [12288, 1536], [3072, 5504], [5504, 3072], [6336, 2688]];
const SIZES_25_1K: [number, number][] = [[1024, 1024], [832, 1248], [1248, 832], [864, 1184], [1184, 864], [896, 1152], [1152, 896], [768, 1344], [1344, 768], [1536, 672]];
/** 2K sizes that also carry the 48 px logo 96 px in. */
const SIZES_2K_INSET: [number, number][] = [[2048, 2048], [2400, 1792]];

const has = (list: [number, number][], width: number, height: number) => list.some(([w, h]) => w === width && h === height);

function isStandardSize(width: number, height: number): boolean {
    return [SIZES_3X_05K, SIZES_3X_1K, SIZES_3X_2K, SIZES_3X_4K, SIZES_25_1K].some(list => has(list, width, height));
}

/** Both sides over 1024 px. A 1024 × 1024 image is small. */
export function isLargeImage(width: number, height: number): boolean {
    return width > 1024 && height > 1024;
}

/** The canonical long side (2752, 2816 or 2848 px) a smaller image was scaled from, for AllenK's proportional layout. */
export function canonicalLongSide(width: number, height: number): number {
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long > 1100) {
        // Half-size images: twice the long side lands on the canonical one.
        let best = 2752;
        for (const candidate of [2816, 2848]) {
            if (Math.abs(2 * long - candidate) < Math.abs(2 * long - best)) best = candidate;
        }
        return best;
    }
    // 1024-class images: the short side tells the sources apart (their heights are about 572, 559 and 540 px).
    return short >= 566 ? 2752 : short >= 550 ? 2816 : 2848;
}

/** The inset 48 px logo is weaker than the 48 px capture: about 0.6 of its opacity (measured on real images, as GargantuaX also uses). */
export const INSET_GAIN = 0.6;

function native(family: Family, mask: MaskId, gain: number, size: number, margin: number, width: number, height: number,
    search: number, sizeSearch = 0): Placement | null {
    const left = width - margin - size, top = height - margin - size;
    if (left < 0 || top < 0) return null;
    const scale = size / MASK_SOURCES[mask].size;
    return { family, mask, gain, left, top, scaleX: scale, scaleY: scale, search, sizeSearch, subpixel: false };
}

/** A placement's logo size in picture pixels, rounded, and its margins from the right and bottom edges. */
export function placementBox(placement: Placement, width: number, height: number): { size: number; marginRight: number; marginBottom: number } {
    const capture = MASK_SOURCES[placement.mask].size;
    const w = capture * placement.scaleX, h = capture * placement.scaleY;
    return {
        size: Math.round((w + h) / 2),
        marginRight: Math.round(width - placement.left - w),
        marginBottom: Math.round(height - placement.top - h),
    };
}

/**
 * The inset logo of a standard 1K size, carried into a picture scaled from it:
 * pictures within 2 % of that size's proportions and 12 % of an even scale.
 * The two best matches, nearest scale first.
 */
function projectedInsets(width: number, height: number): Placement[] {
    const aspect = width / height;
    const found: { placement: Placement; score: number }[] = [];
    for (const [w, h] of SIZES_3X_1K) {
        const scaleX = width / w, scaleY = height / h;
        const aspectDelta = Math.abs(aspect - w / h) / (w / h);
        const mismatch = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
        if (aspectDelta > 0.02 || mismatch > 0.12 || (scaleX + scaleY) / 2 < 0.5 || (scaleX + scaleY) / 2 > 2) continue;
        const left = (w - 96 - 48) * scaleX, top = (h - 96 - 48) * scaleY;
        if (left < 0 || top < 0) continue;
        found.push({
            placement: { family: "inset-96", mask: "v1-48", gain: INSET_GAIN, left, top, scaleX, scaleY, search: 0, sizeSearch: 0, subpixel: true },
            score: aspectDelta * 100 + mismatch * 20 + Math.abs(Math.log2((scaleX + scaleY) / 2)),
        });
    }
    found.sort((a, b) => a.score - b.score);
    return found.slice(0, 2).map(entry => entry.placement);
}

/** Every logo placement to test on an image of this size. */
export function sparklePlacements(width: number, height: number): Placement[] {
    const found: (Placement | null)[] = [];
    const large = isLargeImage(width, height);
    if (large) {
        found.push(native("corner-64", "v1-96", 1, 96, 64, width, height, 0));
        found.push(native("corner-192", "v2-96", 1, 96, 192, width, height, 0));
    } else {
        found.push(native("corner-32", "v1-48", 1, 48, 32, width, height, 0));
        const scale = Math.max(width, height) / canonicalLongSide(width, height);
        const margin = Math.round(192 * scale);
        const scaled = Math.round(96 * scale);
        found.push(scaled <= 40
            ? native("proportional", "v2-36", 1, 36, margin, width, height, 3)
            : native("proportional", "v2-96", 1, scaled, margin, width, height, 3));
    }
    const standard = isStandardSize(width, height);
    const insetHere = !standard || has(SIZES_3X_1K, width, height) || has(SIZES_3X_05K, width, height) || has(SIZES_2K_INSET, width, height);
    if (insetHere) found.push(native("inset-96", "v1-48", INSET_GAIN, 48, 96, width, height, 2, 2));
    if (!standard) found.push(...projectedInsets(width, height));
    return found.filter((placement): placement is Placement => placement !== null);
}

export interface Region {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Pixels the search and the checks read beyond a logo box (the outline pairs reach 3 px out, their controls 6 more). */
export const REGION_PAD = 14;

/**
 * The corner that holds every placement, with room for the searches and the
 * pixels around the logo that the checks compare against. Only this part of
 * a large picture needs reading.
 */
export function sparkleRegion(width: number, height: number): Region | null {
    const placements = sparklePlacements(width, height);
    if (!placements.length) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of placements) {
        const size = MASK_SOURCES[p.mask].size;
        const reach = p.search + p.sizeSearch + (p.subpixel ? 2 : 0) + REGION_PAD;
        left = Math.min(left, Math.floor(p.left) - reach);
        top = Math.min(top, Math.floor(p.top) - reach);
        right = Math.max(right, Math.ceil(p.left + size * p.scaleX) + reach);
        bottom = Math.max(bottom, Math.ceil(p.top + size * p.scaleY) + reach);
    }
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(width, right); bottom = Math.min(height, bottom);
    return { left, top, width: right - left, height: bottom - top };
}
