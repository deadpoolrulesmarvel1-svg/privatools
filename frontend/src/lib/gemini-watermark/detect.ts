/**
 * Find Gemini's visible sparkle and take it back out.
 *
 * Gemini lays a white logo over the picture with alpha blending:
 *
 *     watermarked = alpha · 255 + (1 − alpha) · original
 *
 * so, knowing alpha from the calibrated captures, the original is
 *
 *     original = (watermarked − alpha · 255) / (1 − alpha).
 *
 * Nothing is changed until the logo has been found, and finding it means
 * more than a bright shape in the right place. The test looks at pairs of
 * pixels straddling the logo's outline, one just inside and one just outside.
 * Where the logo is really there, the inside pixel is brighter by exactly
 * what blending white at the logo's opacity predicts, alpha · (255 − outside),
 * and the reverse blend makes the step disappear. Where it is not, removal
 * would cut a dark sparkle into the picture instead. At a candidate position:
 *
 * 1. The logo must be visible: at the outline it would add at least 4 levels
 *    of brightness (root mean square). Over near-white it is left alone.
 * 2. Removal must be possible: at most 5 % of the logo's core may come out
 *    below black (under −40 after the reverse blend, room left for JPEG error).
 * 3. The outline must match the blend, judged in one of two ways, because
 *    fine grain upsets one and picture edges crossing the logo the other:
 *    a. in total: the observed steps are 0.75 to 1.35 times the predicted
 *       ones, and removal leaves at most half of their energy; or
 *    b. pair by pair, for a logo adding at least 8 levels: of at least 20
 *       pairs where it should add 3 levels or more, at least half lose their
 *       step on removal, and the median observed-to-predicted ratio is 0.75
 *       to 1.35. (A pale shape on a pale picture can mimic a fainter logo
 *       pair by pair, so faint ones must pass test a.)
 *
 * An opaque white shape steps up about twice as much as the semi-transparent
 * logo would and does not go away on removal; a dark picture fails 2.
 * detect.test.ts holds these gates to white shapes, see-through panels and a
 * busy synthetic picture scanned at every position. Plain correlation with
 * the opacity map was tried first and rejected: white shapes score as high as
 * the logo, and picture detail crossing the logo drags real ones below any
 * useful threshold.
 *
 * Only the visible logo's pixels are ever changed. Nothing here looks for,
 * reads or alters SynthID or any other invisible or metadata watermark.
 */
import { alphaFor, type AlphaMap } from "./alpha";
import { sparkleCandidates, type Candidate } from "./geometry";

export interface RgbaImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export interface Evidence {
    /** Root-mean-square brightness the logo adds at its outline, in levels. */
    visibility: number;
    /** Share of the logo's core that removal would have to take below black. */
    belowBlack: number;
    /** Observed over predicted step across the whole outline; 1 is an exact match. */
    strength: number;
    /** Share of the outline's step energy left after removal; 0 is none. */
    leftover: number;
    /** Outline pairs where the logo should add 3 levels or more. */
    informative: number;
    /** Share of those pairs whose step removal takes away. */
    explained: number;
    /** Median observed-to-predicted step over those pairs. */
    ratio: number;
}

export interface Detection {
    candidate: Candidate;
    alpha: AlphaMap;
    evidence: Evidence;
}

export const THRESHOLDS = {
    visibility: 4,
    belowBlack: 0.05,
    /** Restored value, in levels, under which a core pixel counts as below black. */
    blackFloor: -40,
    strength: [0.75, 1.35],
    leftover: 0.5,
    /** The pair-by-pair test needs a clearer logo: a pale shape on a pale picture can mimic a faint one pair by pair. */
    pairVisibility: 8,
    informative: 20,
    explained: 0.5,
    ratio: [0.75, 1.35],
} as const;

interface Outline {
    /** Inside pixel, relative to the logo box. */
    ix: Int16Array;
    iy: Int16Array;
    /** First pixel outside the logo in one of the four directions, within 3 px; it may lie outside the box. */
    ox: Int16Array;
    oy: Int16Array;
    /** The inside pixels: those at half the peak opacity or more. */
    core: Uint32Array;
}

const outlines = new WeakMap<AlphaMap, Outline>();

function outline(alpha: AlphaMap): Outline {
    const cached = outlines.get(alpha);
    if (cached) return cached;
    const { size, values } = alpha;
    let peak = 0;
    for (const value of values) peak = Math.max(peak, value);
    const at = (x: number, y: number) => x >= 0 && x < size && y >= 0 && y < size ? values[y * size + x] : 0;
    const ix: number[] = [], iy: number[] = [], ox: number[] = [], oy: number[] = [], core: number[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (values[y * size + x] < peak / 2) continue;
            core.push(y * size + x);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let step = 1; step <= 3; step++) {
                    if (at(x + dx * step, y + dy * step) <= 0.01) {
                        ix.push(x); iy.push(y); ox.push(x + dx * step); oy.push(y + dy * step);
                        break;
                    }
                }
            }
        }
    }
    const result = {
        ix: Int16Array.from(ix), iy: Int16Array.from(iy), ox: Int16Array.from(ox), oy: Int16Array.from(oy),
        core: Uint32Array.from(core),
    };
    outlines.set(alpha, result);
    return result;
}

const brightness = (data: Uint8ClampedArray, i: number) => (data[i] + data[i + 1] + data[i + 2]) / 3;

/** One channel after the reverse blend, unrounded and not yet clamped. */
function unblend(value: number, alpha: number): number {
    const a = Math.min(alpha, 0.99);
    return (value - a * 255) / (1 - a);
}

function restore(value: number, alpha: number): number {
    return alpha <= 0 ? value : Math.min(255, Math.max(0, unblend(value, alpha)));
}

function restoredBrightness(data: Uint8ClampedArray, i: number, alpha: number): number {
    return (restore(data[i], alpha) + restore(data[i + 1], alpha) + restore(data[i + 2], alpha)) / 3;
}

function opaque(image: RgbaImage, x0: number, y0: number, size: number): boolean {
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (image.data[((y0 + y) * image.width + x0 + x) * 4 + 3] !== 255) return false;
        }
    }
    return true;
}

/** Measure the evidence for the logo in the box whose top-left corner is (x0, y0). The box must lie inside the image. */
export function measure(image: RgbaImage, alpha: AlphaMap, x0: number, y0: number): Evidence {
    const { width, height, data } = image;
    const { size, values } = alpha;
    const pairs = outline(alpha);

    let below = 0;
    for (const index of pairs.core) {
        const i = ((y0 + Math.floor(index / size)) * width + x0 + (index % size)) * 4;
        if (unblend(Math.min(data[i], data[i + 1], data[i + 2]), values[index]) < THRESHOLDS.blackFloor) below++;
    }

    let sumOE = 0, sumEE = 0, sumOO = 0, sumAA = 0, count = 0, explained = 0;
    const ratios: number[] = [];
    for (let k = 0; k < pairs.ix.length; k++) {
        const outX = x0 + pairs.ox[k], outY = y0 + pairs.oy[k];
        if (outX < 0 || outY < 0 || outX >= width || outY >= height) continue;
        const inside = ((y0 + pairs.iy[k]) * width + x0 + pairs.ix[k]) * 4;
        const outside = (outY * width + outX) * 4;
        const insideAlpha = values[pairs.iy[k] * size + pairs.ix[k]];
        const inBox = pairs.ox[k] >= 0 && pairs.oy[k] >= 0 && pairs.ox[k] < size && pairs.oy[k] < size;
        const outsideAlpha = inBox ? values[pairs.oy[k] * size + pairs.ox[k]] : 0;
        const outsideBrightness = brightness(data, outside);
        const observed = brightness(data, inside) - outsideBrightness;
        const predicted = insideAlpha * (255 - outsideBrightness);
        const after = restoredBrightness(data, inside, insideAlpha) - restoredBrightness(data, outside, outsideAlpha);
        sumOE += observed * predicted;
        sumEE += predicted * predicted;
        sumOO += observed * observed;
        sumAA += after * after;
        count++;
        if (predicted >= 3) {
            ratios.push(observed / predicted);
            if (observed > 0 && Math.abs(after) <= Math.max(2, 0.35 * observed)) explained++;
        }
    }
    ratios.sort((a, b) => a - b);
    return {
        visibility: count ? Math.sqrt(sumEE / count) : 0,
        belowBlack: pairs.core.length ? below / pairs.core.length : 1,
        strength: sumEE > 1e-9 ? sumOE / sumEE : 0,
        leftover: sumOO > 1e-9 ? sumAA / sumOO : 1,
        informative: ratios.length,
        explained: ratios.length ? explained / ratios.length : 0,
        ratio: ratios.length ? ratios[ratios.length >> 1] : 0,
    };
}

const within = (value: number, [low, high]: readonly [number, number]) => value >= low && value <= high;

export function passes(evidence: Evidence): boolean {
    if (evidence.visibility < THRESHOLDS.visibility || evidence.belowBlack > THRESHOLDS.belowBlack) return false;
    const inTotal = within(evidence.strength, THRESHOLDS.strength) && evidence.leftover <= THRESHOLDS.leftover;
    const pairByPair = evidence.visibility >= THRESHOLDS.pairVisibility && evidence.informative >= THRESHOLDS.informative
        && evidence.explained >= THRESHOLDS.explained && within(evidence.ratio, THRESHOLDS.ratio);
    return inTotal || pairByPair;
}

/** Prefer the fit that leaves least behind. */
const better = (a: Evidence, b: Evidence) => a.leftover < b.leftover || (a.leftover === b.leftover && a.explained > b.explained);

/** The whole picture's size, and where the pixels passed in sit within it (they may be just its corner). */
export interface Frame {
    width: number;
    height: number;
    left: number;
    top: number;
}

const wholeImage = (image: RgbaImage): Frame => ({ width: image.width, height: image.height, left: 0, top: 0 });

/**
 * The best-supported logo on the picture, or null when there is none. Reads
 * pixels and changes nothing. Positions in the result are in the whole
 * picture's coordinates.
 */
export function detectSparkle(image: RgbaImage, frame: Frame = wholeImage(image)): Detection | null {
    let best: Detection | null = null;
    for (const candidate of sparkleCandidates(frame.width, frame.height)) {
        const alpha = alphaFor(candidate.mask, candidate.size);
        // Where the position may vary by a few pixels, every offset is tested and the best fit kept.
        for (let dy = -candidate.search; dy <= candidate.search; dy++) {
            for (let dx = -candidate.search; dx <= candidate.search; dx++) {
                const x = candidate.x + dx - frame.left, y = candidate.y + dy - frame.top;
                if (x < 0 || y < 0 || x + alpha.size > image.width || y + alpha.size > image.height) continue;
                // Gemini's logo sits on opaque pixels; a see-through corner is not its work.
                if (!opaque(image, x, y, alpha.size)) continue;
                const evidence = measure(image, alpha, x, y);
                if (!passes(evidence) || (best && !better(evidence, best.evidence))) continue;
                best = { candidate: { ...candidate, x: x + frame.left, y: y + frame.top }, alpha, evidence };
            }
        }
    }
    return best;
}

/**
 * Reverse the blend inside the detected logo's footprint, in place. Pixels
 * with no logo opacity, and everything outside the logo's box, are not touched.
 */
export function removeSparkle(image: RgbaImage, detection: Detection, frame: Frame = wholeImage(image)): void {
    const { size, values } = detection.alpha;
    const x0 = detection.candidate.x - frame.left, y0 = detection.candidate.y - frame.top;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const alpha = values[y * size + x];
            if (alpha <= 0) continue;
            const i = ((y0 + y) * image.width + x0 + x) * 4;
            image.data[i] = Math.round(restore(image.data[i], alpha));
            image.data[i + 1] = Math.round(restore(image.data[i + 1], alpha));
            image.data[i + 2] = Math.round(restore(image.data[i + 2], alpha));
        }
    }
}
