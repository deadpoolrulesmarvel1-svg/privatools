/**
 * Where Gemini puts its visible sparkle, by image size.
 *
 * The rules are the ones documented by the two projects that measured the
 * logo (github.com/allenk/GeminiWatermarkTool and
 * github.com/GargantuaX/gemini-watermark-remover):
 *
 * - Before Gemini 3.5: a 48 px logo 32 px from the right and bottom edges,
 *   unless both sides are over 1024 px, when it is 96 px, 64 px in.
 * - Gemini 3.5 onwards, large images (both sides over 1024 px): a 96 px logo
 *   192 px in, with the paler May 2026 alpha.
 * - Gemini 3.5 onwards, smaller images: the margin is the 192 px of the large
 *   layout scaled down from the canonical 2752, 2816 or 2848 px source the
 *   image was made at, so it moves with the aspect ratio. The logo is 36 px,
 *   or the 96 px logo scaled the same way when that comes out larger than
 *   40 px (free-tier half-size images such as 1376 × 768 carry a 48 px one).
 *   Rounding differs between sources, so that position is searched 3 px
 *   either way.
 *
 * Each layout is only a place to look: detect.ts decides whether the logo is
 * really there.
 */
import type { MaskId } from "./masks";

export type Layout = "legacy" | "current";

export interface Candidate {
    layout: Layout;
    /** Capture the alpha comes from; resized when `size` differs from it. */
    mask: MaskId;
    /** Logo width and height in pixels. */
    size: number;
    /** Distance from the right and from the bottom edge. */
    margin: number;
    /** Top-left corner of the logo box. */
    x: number;
    y: number;
    /** How many pixels either way the position may be adjusted. */
    search: number;
}

/** Both sides over 1024 px. A 1024 × 1024 image is small. */
export function isLargeImage(width: number, height: number): boolean {
    return width > 1024 && height > 1024;
}

/** The canonical long side (2752, 2816 or 2848 px) a smaller current-layout image was scaled from. */
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

function place(layout: Layout, mask: MaskId, size: number, margin: number, search: number, width: number, height: number): Candidate | null {
    const x = width - margin - size;
    const y = height - margin - size;
    return x >= 0 && y >= 0 ? { layout, mask, size, margin, x, y, search } : null;
}

export interface Region {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * The corner that holds every candidate box, with room for the position
 * search and the pixels just outside the logo that detection compares
 * against. Only this part of a large picture needs reading to decide.
 */
export function sparkleRegion(width: number, height: number): Region | null {
    const candidates = sparkleCandidates(width, height);
    if (!candidates.length) return null;
    const pad = 8;
    const left = Math.max(0, Math.min(...candidates.map(c => c.x)) - pad);
    const top = Math.max(0, Math.min(...candidates.map(c => c.y)) - pad);
    const right = Math.min(width, Math.max(...candidates.map(c => c.x + c.size)) + pad);
    const bottom = Math.min(height, Math.max(...candidates.map(c => c.y + c.size)) + pad);
    return { left, top, width: right - left, height: bottom - top };
}

/** The logo positions to test on an image of this size, earlier layout first. */
export function sparkleCandidates(width: number, height: number): Candidate[] {
    const found: (Candidate | null)[] = [];
    if (isLargeImage(width, height)) {
        found.push(place("legacy", "v1-96", 96, 64, 0, width, height));
        found.push(place("current", "v2-96", 96, 192, 0, width, height));
    } else {
        found.push(place("legacy", "v1-48", 48, 32, 0, width, height));
        const scale = Math.max(width, height) / canonicalLongSide(width, height);
        const margin = Math.round(192 * scale);
        const scaled = Math.round(96 * scale);
        found.push(scaled <= 40
            ? place("current", "v2-36", 36, margin, 3, width, height)
            : place("current", "v2-96", scaled, margin, 3, width, height));
    }
    return found.filter((candidate): candidate is Candidate => candidate !== null);
}
