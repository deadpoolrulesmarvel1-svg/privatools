/**
 * Find Gemini's visible sparkle, fit it, and take it back out.
 *
 * Gemini lays a white logo over the picture with alpha blending:
 *
 *     watermarked = alpha · 255 + (1 − alpha) · original
 *
 * so, knowing alpha, the original is
 *
 *     original = (watermarked − alpha · 255) / (1 − alpha).
 *
 * The logo's shape comes from the calibrated captures (alpha.ts). Where it
 * sits, how large it is and how strong it is are fitted to each picture,
 * starting from the layouts in geometry.ts. Nothing is changed unless all
 * the checks below agree.
 *
 * 1. Is the logo there? Pairs of pixels straddle the logo's outline, one just
 *    inside and one just outside. Where the logo is there, the inside pixel
 *    is brighter by what blending white at the logo's opacity predicts,
 *    alpha · (255 − outside). The pairs that count are those on smooth
 *    picture, where the picture steps by much less than that next to both
 *    pixels, because there the step is the logo's alone. At a candidate:
 *    - the logo must be visible: at the outline it would add at least 4
 *      levels of brightness (root mean square);
 *    - removal must be possible: at most 5 % of the logo's core may come out
 *      below black (under −40 after the reverse blend, room for JPEG error);
 *    - at least 20 pairs are smooth, and their median observed-to-predicted
 *      step is 0.75 to 1.35 (the layout's usual opacity, give or take);
 *    - at least half of the smooth pairs, and at least a quarter of all the
 *      pairs where the logo should add 3 levels or more, lie in that range.
 *    An opaque white shape steps up two or three times as much as the
 *    see-through logo would; a pale veil or glare does not step at the
 *    outline at all; a dark picture fails the second test.
 * 2. Which fit? Every position, size and, for a picture scaled from a
 *    standard size, fraction of a pixel that the layout allows is tested;
 *    a scaled picture's logo is modelled both as Gemini's own scaling draws
 *    it and as a Lanczos resize does (alpha.ts). The fits whose outline
 *    matches nearly as well as the best are kept, and for each the opacity
 *    is fitted: the one that leaves no step across the outline (3), starting
 *    from the smooth pairs' median. Of the fits that come out clean, the one
 *    whose result is smoothest wins.
 * 3. Is it gone? What the reverse blend would leave is judged seven ways
 *    before anything is written, and a fit must pass all of them:
 *    - at the fit's own outline: the step left across it and any ridge along
 *      it, against the same measures taken just beside it, where the logo
 *      never was, so the picture's own texture cancels out;
 *    - the same at the outline of the layout's usual logo, which a fit a
 *      pixel or two smaller than the real logo would leave unremoved;
 *    - over the logo as a whole (`plateau`): its core, soft edge and a halo
 *      just outside, quadrant by quadrant, against a smooth surface fitted to
 *      the picture around it, which sees a faint copy or a thin outline of a
 *      logo over flat colour;
 *    - in its fine detail (`fine`): ringing or an outline that JPEG, a blur
 *      or a resize left, against the picture's own fine detail around it,
 *      which slow shading and bokeh do not raise;
 *    - in its core, direction by direction (`depthResidue`): a logo whose
 *      edge was softened fits too faint, or a sharpened or resampled one too
 *      strong, and its core then comes out brighter or darker than the
 *      picture in most directions at once, which the outline steps, zeroed
 *      by the fit, miss; the darker bound allows for the picture's fine
 *      detail. Over the logo as a whole (`plateau`), the core's two middle
 *      quadrants together may not come out darker than the picture's own
 *      variation at the logo's scale allows: grain has fine detail but
 *      little such variation, so it hides no coherent dark copy, where a
 *      busy texture has both;
 *    - across its interior (`interior`), the one general check: any edit to
 *      the logo's edge, sharpening, blur, JPEG or a resample, biases the
 *      opacity fitted at that edge and leaves a copy of the logo, dark or
 *      light, in the interior. Each outline pair reads the picture beyond
 *      the edge, past any halo, and carries it across to the logo's
 *      interior; the same reading on clean picture beside the logo says what
 *      the picture's own structure reads as there. The interior must agree
 *      over the whole logo, on every side and along the rim, within what the
 *      picture itself can show, the rim must not read the opposite way
 *      from the picture beside it, and the rim's colour must stay the
 *      picture's (JPEG leaves a coloured outline along a sharpened edge);
 *    - the fitted opacity must lie in the range the layout is drawn with,
 *      above which a sharpened copy fits.
 *    The bounds were set on real Gemini images, copies of them saved again
 *    as JPEG, resized and sharpened, and thousands of cases with a known
 *    clean original. A fit over any of them is not written: the picture is
 *    left exactly as it was, and the result says the logo could not be
 *    removed cleanly.
 *
 * detect.test.ts holds these checks to white shapes, see-through panels,
 * glare, logos at the wrong opacity, re-compressed and resized copies over
 * flat colour and over smooth shading, gradients and blurred shapes, and a
 * busy synthetic picture scanned at every position. Plain correlation with
 * the opacity map was tried first and rejected: white shapes score as high
 * as the logo, and picture detail crossing the logo drags real ones below
 * any useful threshold.
 *
 * Only the visible logo's pixels are ever changed. Nothing here looks for,
 * reads or alters SynthID or any other invisible or metadata watermark.
 */
import { alphaFor, placedAlpha, placedLanczos, type AlphaMap, type Kernel } from "./alpha";
import { isStandardSize, placementBox, sparklePlacements, type Family, type Placement } from "./geometry";
import { MASK_SOURCES, type MaskId } from "./masks";

export interface RgbaImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** The whole picture's size, and where the pixels passed in sit within it (they may be just its corner). */
export interface Frame {
    width: number;
    height: number;
    left: number;
    top: number;
}

export interface Evidence {
    /** Root-mean-square brightness the logo adds at its outline, in levels. */
    visibility: number;
    /** Share of the logo's core that removal would have to take below black. */
    belowBlack: number;
    /** Outline pairs where the logo should add 3 levels or more. */
    informative: number;
    /** Those of them on smooth picture. */
    smooth: number;
    /** Median observed-to-predicted step over the smooth pairs; 1 is an exact match. */
    ratio: number;
    /** Share of the smooth pairs whose ratio is 0.75 to 1.35. */
    within: number;
    /** Share of the informative pairs that are smooth and in that range: how much of the outline the fit explains. */
    match: number;
}

export interface Residue {
    /**
     * The step left across the outline after removal, beyond the picture's
     * own, as a share of the logo's step (the mean of the four directions'
     * medians): above 0 where too little was taken out, below 0 where too
     * much. The opacity is fitted to make it 0; `fill` is its size in levels.
     */
    step: number;
    /** Brightness step left across the outline after removal, beyond the picture's own, in levels. */
    fill: number;
    /** A ridge left along the outline, or a step on one side only (a shifted fit), in levels. */
    edge: number;
    /** How much the picture itself varies just outside the outline, in levels. */
    texture: number;
}

export interface Plateau {
    /**
     * Mean brightness left after removal, against a smooth surface fitted to
     * the picture just around the logo, in levels: the worst of the logo's
     * core, soft edge and halo, quadrant by quadrant.
     */
    bump: number;
    /** How far the picture around it strays from that surface (root mean square), in levels. */
    spread: number;
    /**
     * How rough the logo's area is after removal: the 99th percentile, over
     * its pixels, of the largest channel's distance from that channel's
     * surface, in levels, each scaled back by the 1 / (1 − alpha) the reverse
     * blend multiplies the picture's own grain by. A thin outline or coloured
     * speckle shows here.
     */
    rough: number;
    /** The same for the picture around it. */
    ringRough: number;
    /**
     * How far the picture around the logo strays from that surface at the
     * logo's own scale: the root mean square of its distance averaged over
     * COARSE × COARSE pixel blocks, in levels. Grain averages out of it,
     * texture with blobs the size of the logo's arms does not.
     */
    coarse: number;
    /**
     * Mean brightness left in the logo's core, the two middle quadrants
     * together, in levels: what a wrong opacity leaves in every quadrant
     * at once, where picture structure under the logo moves one or two.
     */
    core: number;
}

/**
 * Fine detail after removal: the result minus its blur at 1 pixel (a
 * Gaussian), root mean square, in levels. JPEG ringing, a resampled edge or
 * a thin outline left behind is fine detail the picture around it does not
 * have; slow shading and bokeh are not, so they do not mask it.
 */
export interface Fine {
    /** Over the logo and 2 pixels around it. */
    inside: number;
    /** In a ring 4 to 10 pixels outside it, where the logo never was. */
    ring: number;
}

/** One reading of the interior (see `interior`): what removal leaves, what clean picture beside the logo reads the same way, and how sure each is. */
export interface Reading {
    /** Outline pairs on straight picture that gave a reading. */
    count: number;
    /** The median reading, in levels: above 0 where the picture under the logo came out brighter than the picture beyond its outline predicts, below 0 where darker. */
    left: number;
    /** The same reading taken on clean picture just beyond the outline, where no logo was: what the picture's own structure reads as. */
    nullLeft: number;
    /** The standard error of both medians together, in levels, from their readings' own scatter. */
    scatter: number;
}

/**
 * What removal leaves in the logo's interior, read against the picture
 * beyond its outline: over the whole logo, side by side, and along the soft
 * rim. A wrong opacity shows over the whole logo; a fit a fraction of a pixel
 * off its logo on one side shows on that side; a rim left over shows along
 * the rim.
 */
export interface Interior {
    whole: Reading;
    /** By the direction out of the logo (DIRECTIONS); null where too few pairs could be read. */
    sides: (Reading | null)[];
    rim: Reading | null;
    /**
     * The rim's colour against the picture's just outside: each channel's
     * departure from the pixel's own brightness, the rim's minus the
     * reference's, as the length of the median vector over the pairs
     * (`left`), with the same reading on clean picture beside the logo
     * (`nullLeft`) and both medians' scatter. A coloured outline that JPEG's
     * chroma leaves along a sharpened edge shows here; brightness readings
     * do not see it.
     */
    colour: Reading | null;
}

/** A logo's size and its distance from the right and bottom edges, in pixels, rounded. */
export interface Geometry {
    size: number;
    marginRight: number;
    marginBottom: number;
}

export interface Fit extends Geometry {
    family: Family;
    /** For a picture scaled from a standard size: how its scaling was modelled. */
    kernel?: Kernel;
    mask: MaskId;
    /** The logo's box in the whole picture: its top-left corner. */
    x: number;
    y: number;
    /** The logo's shape, at the capture's opacity. */
    map: AlphaMap;
    /** The fitted opacity, as a multiple of the capture's. */
    gain: number;
    /** Where the layout usually puts its logo, which the fit may differ from by a pixel or two. */
    layout: Geometry;
    evidence: Evidence;
    /** What removal leaves at the fit's own outline. */
    residue: Residue;
    /** What removal leaves at the outline of the layout's usual logo. */
    layoutResidue: Residue;
    /** What removal leaves over the logo as a whole. */
    plateau: Plateau;
    /** Fine detail removal leaves over the logo, against the picture around it. */
    fine: Fine;
    /** What removal leaves in the logo's core, direction by direction (see `depthResidue`), in levels. */
    depth: number[];
    /** What removal leaves in the logo's interior against the picture beyond its outline (see `interior`). */
    interior: Interior;
    /** Whether the opacity lies in the range that layout is drawn with. */
    opacityInRange: boolean;
    /** Whether the result passes every check; only then is it written. */
    clean: boolean;
}

export const THRESHOLDS = {
    visibility: 4,
    belowBlack: 0.05,
    /** Restored value, in levels, under which a core pixel counts as below black. */
    blackFloor: -40,
    /** A pair is informative where the logo should add at least this many levels. */
    informative: 3,
    /** A pair is smooth where the picture next to it steps by at most this share of the logo's step. */
    smoothness: 0.35,
    smoothPairs: 20,
    ratio: [0.75, 1.35],
    within: 0.5,
    /**
     * The share of informative pairs that must be smooth and in range. The
     * logos on six real Gemini pictures score 0.34 to 1. Of 9.2 million
     * windows slid over the same pictures away from their logos, none that
     * passed the other checks scored above 0.22.
     */
    match: 0.25,
    /** Residue bounds, in levels: the larger of a floor and a share of the picture's own texture. */
    fill: { floor: 4.5, share: 0.4 },
    edge: { floor: 6, share: 0.5 },
    /**
     * What may be left in any region of the logo (see `plateau`), in levels:
     * the larger of a floor and a share of how far the picture around it
     * strays from a smooth surface. Over flat colour that is 2 levels. Over
     * busy detail the surface cannot follow the picture, so the bound grows
     * with it and the outline checks above decide.
     */
    plateau: { floor: 2, share: 2 },
    /**
     * How much rougher the logo's area may be after removal than the picture
     * around it (see `Plateau.rough`), in levels: the larger of a floor and a
     * share of the picture's own. A thin outline left by a fit a fraction of
     * a pixel off, or JPEG ringing around a removed logo, shows here.
     */
    rough: { floor: 3, share: 1.6 },
    /**
     * How dark the logo's core, its two middle quadrants together, may come
     * out against the picture's surface (see `Plateau.core`): the larger of
     * `floor` levels and `share` times the picture's own variation at the
     * logo's scale (`Plateau.coarse`). A sharpened copy saved again as JPEG
     * over per-pixel grain fits within the layout's range and reads each
     * direction of its core noisily (−20 to +6 on one logo), yet its core as
     * a whole is 4 to 13 levels darker, a dark copy of the logo plain at
     * 100 %; grain hides nothing at the logo's scale (a coarse variation of
     * 1 to 3). A legitimate logo over bokeh or a soft field reads −8 to −27
     * where the picture itself varies by 9 to 26 (up to 1.05 times), and the
     * kanji sample −33 against 65, so the share stays above those.
     */
    core: { floor: 4, share: 1.25 },
    /**
     * Fine detail over the logo after removal (see `Fine`), in levels: at
     * most the larger of a floor and a share of the ring's. Real Gemini
     * pictures come out at 0.9 to 1.25 times the ring; JPEG ringing or a
     * resampled outline over smooth picture, at 2 to 5 times.
     */
    fine: { floor: 1, share: 1.7 },
    /**
     * What removal may leave in the logo's core (see `depthResidue`), in
     * levels. A logo removed too faintly leaves its core brighter than the
     * picture around it in three or four directions at once; the picture's
     * own structure seldom does that. `under` bounds the third-largest of
     * the four. Over strong per-pixel grain a small logo's core reads too
     * noisily to pass it, and is left unchanged. The core coming out darker
     * in three or four directions is bounded too: on a logo that was scaled
     * (a picture scaled from a standard size, or a logo a pixel off its
     * layout's size), where the scaling kernel is not known, by `over`; on
     * a logo at its layout's own size by `native`, the larger of a floor
     * and a share of the picture's fine detail around the logo, since a
     * sharpened copy fits 1.15 to 1.4 times the opacity drawn and cuts its
     * core in darker, while legitimate removals over busy texture read as
     * low as −12 against fine detail of 17 to 19. Over per-pixel grain each
     * direction reads too noisily for this check (−20 to +6 on one logo);
     * the core as a whole is judged by `core` below.
     */
    depth: { under: 3, over: 2, native: { floor: 4, share: 0.75 } },
    /**
     * The fitted opacity must lie within these multiples of the layout's
     * usual one, from a floor to a ceiling per layout. Real logos 96 px in
     * fit 0.98–1.19 times it (0.59–0.71 of the capture; 1-1 fits 1.188),
     * and the 48 px corner logo fits the capture's own (20260520-1: 0.998).
     * JPEG and blur soften a logo's edge, which makes its fit read faint,
     * so a fit under the floor is not removed; sharpening steepens it, which
     * makes it read strong (sharpened copies fit 1.16–1.38 times), so a fit
     * over the ceiling is not removed either; it describes another logo or
     * an edited one.
     */
    opacity: { floor: { "inset-96": 0.9, other: 0.95 }, ceiling: { "inset-96": 1.22, other: 1.1 } },
    /**
     * What removal may leave in the logo's interior, read against the
     * picture beyond the outline (see `interior`), in levels: over the whole
     * logo (`whole`), on any one side (`side`) and along the soft rim
     * (`rim`), each the largest of that floor, `share` times what the same
     * reading finds on clean picture beside the logo plus its own scatter
     * (wider for a side, read from a quarter of the pairs), and `texture`
     * times the picture's fine detail around the logo, under which a
     * remnant does not show. A fit of a resampled copy (a logo scaled after
     * Gemini drew it, or a picture of a size Gemini does not make) is
     * modelled only approximately, so its bounds are tighter (`resampled`).
     * A reading needs `pairs` outline pairs on straight picture; a side
     * needs `sidePairs`. The rim's reading must also not disagree with its
     * null in sign by more than `disagree` times their scatter: a rim left
     * dark where the picture's own structure reads bright is not that
     * structure, however busy the picture (a sharpened copy saved again as
     * JPEG over fur read −8 against a null of +10). The rim's colour, read
     * the same way (see `Interior.colour`), may depart from the picture's
     * by at most `colour` levels, or `share.rim` times its null plus
     * scatter: a sharpened copy saved again as JPEG at quality 80 left an
     * orange outline reading 9.7 levels, visible at 100 %, and one saved at
     * quality 85 an outline reading 8.5, visible at 200 %, where the six
     * real samples read 0.6 to 1.6 and copies with speckle only at 200 %
     * read up to 7.6.
     */
    interior: {
        native: { whole: 4, side: 6, rim: 6, texture: 1.3 },
        resampled: { whole: 3, side: 4, rim: 3, texture: 0.7 },
        share: { whole: 1.25, side: 1.5, rim: 1.5 }, disagree: 2, colour: 8, pairs: 12, sidePairs: 24,
    },
} as const;

/** The ring around the logo that the plateau check reads: from this many pixels outside its footprint, to this many. */
const RING = [3, 8] as const;
/** The fine-detail check reads the logo and this many pixels around it, against a ring from FINE_RING[0] to FINE_RING[1] pixels out. */
const FINE_NEAR = 2;
const FINE_RING = [4, 10] as const;
/** A Gaussian of 1 pixel, as weights from its centre out to 3 pixels, summing to 1 over -3..3. */
const BLUR = (() => {
    const weights = [0, 1, 2, 3].map(d => Math.exp(-(d * d) / 2));
    const total = weights[0] + 2 * (weights[1] + weights[2] + weights[3]);
    return weights.map(w => w / total);
})();
/** The core residue reads this many pixels deeper than the outline's inside pixel, and this many beyond its outside one. */
const DEPTH = 2;
const GAP = 1;
/**
 * The interior check (see `interior`) reads this many pixels deeper than the
 * outline's inside pixel, against the picture from this many pixels beyond
 * its outside one, where a sharpening halo or JPEG ringing no longer reaches.
 */
const INSIDE = 2;
const BEYOND = 2;
/** Side of the blocks the ring's distance from its surface is averaged over for `Plateau.coarse`, in pixels: a quarter of the 48 px logo, the scale of its arms and of its core's quadrants. */
const COARSE = 6;
/** The picture outside counts as straight where its steps, over INSIDE pixels, stay under this share of the logo's step, and differ by less than this share. */
const STRAIGHT = 0.35;
const CURVED = 0.15;

/** The opacity is searched from 0.8 to 1.25 times the smooth pairs' estimate, halving the interval this many times. */
const GAIN_RANGE = [0.8, 1.25] as const;
const GAIN_HALVINGS = 12;
/**
 * Of the layout that matches best, fits whose outline match is within this
 * share of the best one's are fitted for opacity, at most SHORTLIST of them.
 * Matching first matters: on a faint logo over busy detail, a fit a pixel too
 * small can leave a residue the outline test misses, and over strong grain a
 * logo of another shape at the same spot can look as clean.
 */
const SHORTLIST_MATCH = 0.9;
const SHORTLIST = 24;
/** Map pixels at or under this opacity count as outside the logo. */
const OUTSIDE = 0.01;
const DIRECTIONS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface Outline {
    count: number;
    /** Inside pixel, relative to the map's box. */
    ix: Int16Array;
    iy: Int16Array;
    /** Index into DIRECTIONS of the way out. */
    direction: Uint8Array;
    /** Pixels from the inside pixel to the first outside one, 1 to 3; that one may lie outside the box. */
    step: Uint8Array;
    /** Whether the pixel one further in is also in the core. */
    deeper: Uint8Array;
    /** The inside pixels: those at half the peak opacity or more. */
    core: Uint32Array;
}

const outlines = new WeakMap<AlphaMap, Outline>();

function outline(map: AlphaMap): Outline {
    const cached = outlines.get(map);
    if (cached) return cached;
    const { width, height, values } = map;
    let peak = 0;
    for (const value of values) peak = Math.max(peak, value);
    const inBox = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
    const at = (x: number, y: number) => inBox(x, y) ? values[y * width + x] : 0;
    const isCore = (x: number, y: number) => inBox(x, y) && values[y * width + x] >= peak / 2;
    const ix: number[] = [], iy: number[] = [], direction: number[] = [], step: number[] = [], deeper: number[] = [], core: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isCore(x, y)) continue;
            core.push(y * width + x);
            DIRECTIONS.forEach(([dx, dy], d) => {
                for (let s = 1; s <= 3; s++) {
                    if (at(x + dx * s, y + dy * s) <= OUTSIDE) {
                        ix.push(x); iy.push(y); direction.push(d); step.push(s); deeper.push(isCore(x - dx, y - dy) ? 1 : 0);
                        break;
                    }
                }
            });
        }
    }
    const result: Outline = {
        count: ix.length,
        ix: Int16Array.from(ix), iy: Int16Array.from(iy), direction: Uint8Array.from(direction),
        step: Uint8Array.from(step), deeper: Uint8Array.from(deeper), core: Uint32Array.from(core),
    };
    outlines.set(map, result);
    return result;
}

const brightness = (data: Uint8ClampedArray, i: number) => (data[i] + data[i + 1] + data[i + 2]) / 3;

/** One channel after the reverse blend, unrounded and not yet clamped. */
function unblend(value: number, alpha: number): number {
    return (value - alpha * 255) / (1 - alpha);
}

/**
 * One channel as removal writes it: reversed, rounded and clamped. Where the
 * logo has no opacity the pixel is left as it is; where it is slightly
 * negative, the overshoot of a Lanczos-scaled logo, the darkening is undone.
 */
function restore(value: number, alpha: number): number {
    return alpha === 0 ? value : Math.round(Math.min(255, Math.max(0, unblend(value, alpha))));
}

function restoredBrightness(data: Uint8ClampedArray, i: number, alpha: number): number {
    return (restore(data[i], alpha) + restore(data[i + 1], alpha) + restore(data[i + 2], alpha)) / 3;
}

/** The logo's opacity at a pixel of its box, or 0 outside the box. */
function opacity(map: AlphaMap, gain: number, x: number, y: number): number {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
    return Math.min(0.99, map.values[y * map.width + x] * gain);
}

function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The evidence for the logo `map` at `gain` times its opacity, in the box
 * whose top-left corner is (x0, y0). The box must lie inside the image.
 */
export function measure(image: RgbaImage, map: AlphaMap, gain: number, x0: number, y0: number): Evidence {
    const { width, height, data } = image;
    const line = outline(map);

    let below = 0;
    for (const index of line.core) {
        const i = ((y0 + Math.floor(index / map.width)) * width + x0 + (index % map.width)) * 4;
        const alpha = Math.min(0.99, map.values[index] * gain);
        if (unblend(Math.min(data[i], data[i + 1], data[i + 2]), alpha) < THRESHOLDS.blackFloor) below++;
    }

    let sumEE = 0, count = 0, informative = 0;
    const ratios: number[] = [];
    for (let k = 0; k < line.count; k++) {
        const [dx, dy] = DIRECTIONS[line.direction[k]];
        const s = line.step[k];
        const ix = line.ix[k], iy = line.iy[k];
        const ox = ix + dx * s, oy = iy + dy * s;
        // The outside pixel and the one beyond it must be in the picture.
        const farX = x0 + ox + dx, farY = y0 + oy + dy;
        if (farX < 0 || farY < 0 || farX >= width || farY >= height) continue;
        const inside = ((y0 + iy) * width + x0 + ix) * 4;
        const outside = ((y0 + oy) * width + x0 + ox) * 4;
        const beyond = (farY * width + farX) * 4;
        const ix2 = line.deeper[k] ? ix - dx : ix, iy2 = line.deeper[k] ? iy - dy : iy;
        const inner = ((y0 + iy2) * width + x0 + ix2) * 4;

        const insideAlpha = opacity(map, gain, ix, iy);
        const outsideBrightness = brightness(data, outside);
        const observed = brightness(data, inside) - outsideBrightness;
        const predicted = insideAlpha * (255 - outsideBrightness);
        sumEE += predicted * predicted;
        count++;
        if (predicted < THRESHOLDS.informative) continue;
        informative++;
        // How much the picture itself steps next to the pair, judged with the logo taken out.
        const texture = Math.max(
            Math.abs(restoredBrightness(data, outside, opacity(map, gain, ox, oy)) - restoredBrightness(data, beyond, opacity(map, gain, ox + dx, oy + dy))),
            Math.abs(restoredBrightness(data, inside, insideAlpha) - restoredBrightness(data, inner, opacity(map, gain, ix2, iy2))),
        );
        if (texture <= THRESHOLDS.smoothness * predicted) ratios.push(observed / predicted);
    }
    const [low, high] = THRESHOLDS.ratio;
    const inRange = ratios.filter(r => r >= low && r <= high).length;
    return {
        visibility: count ? Math.sqrt(sumEE / count) : 0,
        belowBlack: line.core.length ? below / line.core.length : 1,
        informative,
        smooth: ratios.length,
        ratio: median(ratios),
        within: ratios.length ? inRange / ratios.length : 0,
        match: informative ? inRange / informative : 0,
    };
}

/** Whether the evidence shows the logo. */
export function passes(evidence: Evidence): boolean {
    const [low, high] = THRESHOLDS.ratio;
    return evidence.visibility >= THRESHOLDS.visibility
        && evidence.belowBlack <= THRESHOLDS.belowBlack
        && evidence.smooth >= THRESHOLDS.smoothPairs
        && evidence.ratio >= low && evidence.ratio <= high
        && evidence.within >= THRESHOLDS.within
        && evidence.match >= THRESHOLDS.match;
}

/**
 * What removing the logo `map` at `gain` times its opacity from the box at
 * (x0, y0) would leave behind, read from the pixels removal would write.
 *
 * Each outline pair (inside pixel i, outside pixel o, k pixels apart in
 * direction u) is read after the reverse blend. The step from i to o is
 * compared with the same-length steps just outside (o to o + k·u) and just
 * inside (i − k·u to i), where the logo leaves no step, so a gradient in the
 * picture counts on both sides and cancels. A ridge along the outline (the
 * pixels between i and o bulging from a straight line) is compared with the
 * same measure one pair-length further out. Medians are taken per direction:
 * a wrong opacity moves all four alike (fill), a shifted or wrongly sized
 * fit moves opposite sides apart or leaves a ridge (edge).
 *
 * The outline read is the removed logo's own, or another logo's: the
 * layout's usual one, `at`. A fit a pixel or two smaller than the real logo
 * leaves its rim outside the fit's outline, where only the larger outline
 * sees it.
 */
export function residue(image: RgbaImage, map: AlphaMap, gain: number, x0: number, y0: number, at?: Drawn): Residue {
    const { width, height, data } = image;
    const read: Drawn = at ?? { map, gain, x: x0, y: y0 };
    const line = outline(read.map);
    const after = (x: number, y: number) => restoredBrightness(data, (y * width + x) * 4, opacity(map, gain, x - x0, y - y0));
    const before = (x: number, y: number) => brightness(data, (y * width + x) * 4);
    const fills: number[][] = [[], [], [], []], ridges: number[][] = [[], [], [], []];
    const steps: number[] = [], textures: number[] = [];
    for (let k = 0; k < line.count; k++) {
        const d = line.direction[k];
        const [dx, dy] = DIRECTIONS[d];
        const s = line.step[k];
        const ix = read.x + line.ix[k], iy = read.y + line.iy[k];
        const ox = ix + dx * s, oy = iy + dy * s;
        // Reads reach two pair-lengths beyond the outside pixel and one inside the inside one.
        const farX = ox + 2 * dx * s, farY = oy + 2 * dy * s, backX = ix - dx * s, backY = iy - dy * s;
        if (Math.min(farX, farY, backX, backY) < 0 || Math.max(farX, backX) >= width || Math.max(farY, backY) >= height) continue;
        const predicted = opacity(read.map, read.gain, line.ix[k], line.iy[k]) * (255 - before(ox, oy));
        if (predicted < THRESHOLDS.informative) continue;
        const inside = after(ix, iy), outside = after(ox, oy), beyond = after(ox + dx * s, oy + dy * s);
        const fill = inside - outside;
        const control = ((outside - beyond) + (after(backX, backY) - inside)) / 2;
        fills[d].push((fill - control) / predicted);
        if (s >= 2) {
            let ridge = 0, ridgeControl = 0;
            for (let j = 1; j < s; j++) {
                const t = j / s;
                const v = after(ix + dx * j, iy + dy * j) - (inside * (1 - t) + outside * t);
                if (Math.abs(v) > Math.abs(ridge)) ridge = v;
                const w = after(ox + dx * j, oy + dy * j) - (outside * (1 - t) + beyond * t);
                if (Math.abs(w) > Math.abs(ridgeControl)) ridgeControl = w;
            }
            ridges[d].push((ridge - ridgeControl) / predicted);
        }
        steps.push(predicted);
        textures.push(Math.abs(before(ox, oy) - before(ox + dx * s, oy + dy * s)));
    }
    const group = (values: number[]) => values.length >= 5 ? median(values) : 0;
    const f = fills.map(group), r = ridges.map(group);
    const typical = median(steps);
    const fill = Math.abs((f[0] + f[1] + f[2] + f[3]) / 4) * typical;
    const edge = Math.max(
        Math.abs(f[0] - f[1]) / 2, Math.abs(f[2] - f[3]) / 2,
        Math.abs((r[0] + r[1] + r[2] + r[3]) / 4), Math.abs(r[0] - r[1]) / 2, Math.abs(r[2] - r[3]) / 2,
    ) * typical;
    return { step: (f[0] + f[1] + f[2] + f[3]) / 4, fill, edge, texture: median(textures) };
}

/** A logo as drawn: its shape, where its box sits in the pixels passed in, and its opacity as a multiple of the shape's. */
export interface Drawn {
    map: AlphaMap;
    x: number;
    y: number;
    gain: number;
}

/** Distance from a footprint by 4-neighbour steps, in a w × h box: 0 inside it, up to `outer`, -1 beyond. */
function distances(w: number, h: number, inside: (x: number, y: number) => boolean, outer: number): Int8Array {
    const distance = new Int8Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) distance[y * w + x] = 0;
    for (let d = 1; d <= outer; d++) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (distance[i] !== -1) continue;
                if ((x > 0 && distance[i - 1] === d - 1) || (x + 1 < w && distance[i + 1] === d - 1)
                    || (y > 0 && distance[i - w] === d - 1) || (y + 1 < h && distance[i + w] === d - 1)) distance[i] = d;
            }
        }
    }
    return distance;
}

/**
 * What removing `removed` leaves over the logo as a whole, region by region:
 * the mean brightness after removal, against a smooth (quadratic) surface
 * fitted to a ring of picture just around the footprint (3 to 8 pixels out,
 * beyond any softened edge). The regions are the removed logo's core, its
 * soft edge, and a halo 1 to 2 pixels outside it, each in four quadrants, and
 * the core of the layout's usual logo (`layout`). The worst one counts.
 *
 * The outline checks above read steps a few pixels long, so a copy of the
 * logo whose edges were softened, by a JPEG saved again or a resize, leaves
 * them nothing to see; and a fit a pixel smaller than the real logo leaves
 * its rim as a thin outline that their medians dilute. Over flat colour these
 * regions see both at once. Over busy detail the surface cannot follow the
 * picture, its spread says so, and the bound grows with it.
 */
export function plateau(image: RgbaImage, removed: Drawn, layout?: { map: AlphaMap; x: number; y: number }): Plateau {
    const { width, height, data } = image;
    const [inner, outer] = RING;
    const shapes = layout ? [removed, layout] : [removed];
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { map, x, y } of shapes) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + map.width); bottom = Math.max(bottom, y + map.height);
    }
    left = Math.max(0, left - outer); top = Math.max(0, top - outer);
    right = Math.min(width, right + outer); bottom = Math.min(height, bottom + outer);
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) return { bump: 0, spread: 0, rough: 0, ringRough: 0, coarse: 0, core: 0 };
    const peaks = shapes.map(({ map }) => map.values.reduce((max, value) => Math.max(max, value), 0));
    const alphaOf = (k: number, x: number, y: number) => opacity(shapes[k].map, 1, left + x - shapes[k].x, top + y - shapes[k].y);
    const fromAll = distances(w, h, (x, y) => shapes.some((_, k) => alphaOf(k, x, y) > OUTSIDE), outer);
    const fromRemoved = layout ? distances(w, h, (x, y) => alphaOf(0, x, y) > OUTSIDE, outer) : fromAll;
    /** The three channels as removal would write them. */
    const after = (x: number, y: number) => {
        const i = ((top + y) * width + left + x) * 4;
        const alpha = opacity(removed.map, removed.gain, left + x - removed.x, top + y - removed.y);
        return [restore(data[i], alpha), restore(data[i + 1], alpha), restore(data[i + 2], alpha)];
    };
    // Least squares for a quadratic surface per channel over the ring, centred on the area so the terms stay well scaled.
    const cx = w / 2, cy = h / 2, scale = Math.max(w, h) / 2;
    const terms = (x: number, y: number) => {
        const u = (x - cx) / scale, v = (y - cy) / scale;
        return [1, u, v, u * u, u * v, v * v];
    };
    const normals = [0, 1, 2].map(() => Array.from({ length: 6 }, () => new Float64Array(7)));
    const ring: [number, number, number[]][] = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (fromAll[y * w + x] < inner) continue;
            const values = after(x, y), t = terms(x, y);
            ring.push([x, y, values]);
            for (let c = 0; c < 3; c++) {
                for (let i = 0; i < 6; i++) {
                    for (let j = 0; j < 6; j++) normals[c][i][j] += t[i] * t[j];
                    normals[c][i][6] += t[i] * values[c];
                }
            }
        }
    }
    if (ring.length < 30) return { bump: 0, spread: Infinity, rough: 0, ringRough: Infinity, coarse: Infinity, core: 0 };
    const surfaces = normals.map(solve);
    /** How far each channel lies from its surface. */
    const offsets = (x: number, y: number, values: number[]) => {
        const t = terms(x, y);
        return values.map((value, c) => value - t.reduce((sum, term, i) => sum + term * surfaces[c][i], 0));
    };
    let squares = 0;
    const ringDistances: number[] = [];
    const blocksAcross = Math.ceil(w / COARSE);
    const blockSum = new Float64Array(blocksAcross * Math.ceil(h / COARSE)), blockCount = new Float64Array(blockSum.length);
    for (const [x, y, values] of ring) {
        const d = offsets(x, y, values);
        const offset = (d[0] + d[1] + d[2]) / 3;
        squares += offset ** 2;
        ringDistances.push(Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])));
        const block = Math.floor(y / COARSE) * blocksAcross + Math.floor(x / COARSE);
        blockSum[block] += offset; blockCount[block]++;
    }
    // The ring's distance from the surface averaged over blocks, where a block has at least half its pixels on the ring.
    let coarseSquares = 0, coarseBlocks = 0;
    for (let block = 0; block < blockSum.length; block++) {
        if (blockCount[block] < COARSE * COARSE / 2) continue;
        coarseSquares += (blockSum[block] / blockCount[block]) ** 2; coarseBlocks++;
    }
    const spread = Math.sqrt(squares / ring.length);
    const coarse = coarseBlocks >= 4 ? Math.sqrt(coarseSquares / coarseBlocks) : spread;
    const logoDistances: number[] = [];
    // Regions 0–3: the removed logo's core by quadrant; 4–7 its soft edge; 8–11 its halo; 12 the layout's core.
    const sum = new Float64Array(13), count = new Float64Array(13);
    const midX = removed.x - left + removed.map.width / 2, midY = removed.y - top + removed.map.height / 2;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const value = alphaOf(0, x, y), distance = fromRemoved[y * w + x];
            const quadrant = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);
            let region = -1;
            if (value >= peaks[0] / 2) region = quadrant;
            else if (value > OUTSIDE) region = 4 + quadrant;
            else if (distance === 1 || distance === 2) region = 8 + quadrant;
            const inLayoutCore = layout && alphaOf(1, x, y) >= peaks[1] / 2;
            if (region < 0 && !inLayoutCore) continue;
            const d = offsets(x, y, after(x, y));
            const leftOver = (d[0] + d[1] + d[2]) / 3;
            if (region >= 0) { sum[region] += leftOver; count[region]++; }
            if (inLayoutCore) { sum[12] += leftOver; count[12]++; }
            // The reverse blend multiplies the picture's own grain by 1 / (1 − alpha); scale that back out.
            const amplified = 1 - Math.min(0.99, value * removed.gain);
            logoDistances.push(Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])) * amplified);
        }
    }
    let bump = 0;
    const quadrants: number[] = [];
    for (let region = 0; region < 13; region++) {
        if (count[region] < 12) continue;
        const mean = sum[region] / count[region];
        if (Math.abs(mean) > Math.abs(bump)) bump = mean;
        if (region < 4) quadrants.push(mean);
    }
    quadrants.sort((a, b) => b - a);
    const core = quadrants.length >= 2 ? (quadrants.length === 4 ? (quadrants[1] + quadrants[2]) / 2 : quadrants[Math.floor(quadrants.length / 2)]) : 0;
    return { bump, spread, rough: percentile(logoDistances, 0.99), ringRough: percentile(ringDistances, 0.99), coarse, core };
}

/**
 * What removing the logo `map` at `gain` from the box at (x0, y0) leaves in
 * its core, direction by direction, in levels. Each outline pair is read
 * DEPTH pixels further in than its inside pixel, where JPEG ringing, blur and
 * a resampled edge no longer reach, and GAP pixels beyond its outside pixel,
 * after the reverse blend; the picture's own step over the same distance
 * just outside is taken off, so a gradient cancels. Medians are taken per
 * direction. Where a logo's edge was softened after Gemini drew it, the
 * opacity fit (which zeroes the step at the edge) reads it too faint or too
 * strong, and its core comes out brighter or darker in most directions at
 * once; picture structure under the logo moves one or two of them.
 */
export function depthResidue(image: RgbaImage, map: AlphaMap, gain: number, x0: number, y0: number): number[] {
    const { width, height, data } = image;
    const line = outline(map);
    let peak = 0;
    for (const value of map.values) peak = Math.max(peak, value);
    const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height ? map.values[y * map.width + x] : 0;
    const inImage = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const after = (x: number, y: number) => restoredBrightness(data, (y * width + x) * 4, opacity(map, gain, x - x0, y - y0));
    const groups: number[][] = [[], [], [], []];
    const steps: number[] = [];
    for (let k = 0; k < line.count; k++) {
        const d = line.direction[k];
        const [dx, dy] = DIRECTIONS[d];
        const s = line.step[k];
        const ix = line.ix[k] - dx * DEPTH, iy = line.iy[k] - dy * DEPTH;
        if (inMap(ix, iy) < peak / 2) continue;
        const ox = line.ix[k] + dx * (s + GAP), oy = line.iy[k] + dy * (s + GAP);
        const length = s + DEPTH + GAP;
        let clear = true;
        for (let j = -GAP; j <= length && clear; j++) if (inMap(ox + dx * j, oy + dy * j) > OUTSIDE) clear = false;
        const fx = ox + dx * length, fy = oy + dy * length;
        if (!clear || !inImage(x0 + fx, y0 + fy) || !inImage(x0 + ix, y0 + iy)) continue;
        const predicted = opacity(map, gain, ix, iy) * (255 - brightness(data, ((y0 + oy) * width + x0 + ox) * 4));
        if (predicted < THRESHOLDS.informative) continue;
        const inside = after(x0 + ix, y0 + iy), outside = after(x0 + ox, y0 + oy), far = after(x0 + fx, y0 + fy);
        groups[d].push(((inside - outside) - (outside - far)) / predicted);
        steps.push(predicted);
    }
    const typical = median(steps);
    return groups.map(values => values.length >= 5 ? median(values) * typical : 0);
}

/** Readings as shares of the logo's step, with the step itself, for one set of pairs (the real reading and its null). */
interface Readings {
    real: number[];
    nulls: number[];
    steps: number[];
}

const newReadings = (): Readings => ({ real: [], nulls: [], steps: [] });

/** Colour readings: per-pair vectors of each channel's departure, the real ones and their nulls. */
interface ColourReadings {
    real: number[][];
    nulls: number[][];
}

/** The median vector's length and the standard error of its channels' medians, as `summarise` takes them. */
function summariseColour(vectors: number[][]): { median: number; error: number } {
    const channels = [0, 1, 2].map(c => summarise(vectors.map(v => v[c]), 1));
    return { median: Math.hypot(...channels.map(ch => ch.median)), error: Math.hypot(...channels.map(ch => ch.error)) };
}

function colourReading(set: ColourReadings): Reading | null {
    if (set.real.length < THRESHOLDS.interior.pairs) return null;
    const real = summariseColour(set.real), nulls = set.nulls.length ? summariseColour(set.nulls) : { median: 0, error: 0 };
    return { count: set.real.length, left: real.median, nullLeft: nulls.median, scatter: real.error + nulls.error };
}

/** The median and the standard error of a median, from the readings' own scatter; neighbouring pairs read the same picture, so three count as one. */
function summarise(values: number[], typical: number): { median: number; error: number } {
    const m = median(values);
    const spread = median(values.map(v => Math.abs(v - m)));
    return { median: m * typical, error: 1.25 * spread * typical / Math.sqrt(Math.max(1, values.length / 3)) };
}

function reading(set: Readings, typical: number): Reading {
    const real = summarise(set.real, typical), nulls = set.nulls.length ? summarise(set.nulls, typical) : { median: 0, error: 0 };
    return { count: set.real.length, left: real.median, nullLeft: nulls.median, scatter: real.error + nulls.error };
}

/**
 * What removing the logo `map` at `gain` from the box at (x0, y0) leaves in
 * its interior, read against the picture beyond its outline. For each
 * outline pair (inside core pixel i, first outside pixel o, s pixels apart in
 * direction u) the picture is read, after the reverse blend, at ref = o +
 * BEYOND·u, past any halo or ringing an edit left at the edge, and at far =
 * ref + INSIDE·u; where it is straight there (the two steps small against the
 * logo's own and alike), the line through ref and far is carried to the
 * pixel INSIDE deeper than i. What that pixel reads above the line is one
 * reading, as a share of the logo's step at i. The pixels between i and o
 * (the soft rim) are read against the same line.
 *
 * The same reading is then taken with the whole line of pixels moved outward
 * by the same distances, so that it reads clean picture beside the logo:
 * what this picture's own structure reads as, at the same spot and
 * orientation, with no logo at all. Medians are taken over every pair, by
 * direction and along the rim; their scatter gives each median's error.
 *
 * The outline fit zeroes the step at the outline itself, so a logo whose
 * edge was sharpened, blurred or resampled fits at the wrong opacity and its
 * interior comes out darker or brighter than the picture around it; a fit a
 * fraction of a pixel off its logo does so on one side. The outline checks
 * cannot see either; this reading can, wherever the picture is straight
 * enough to carry across the outline.
 */
export function interior(image: RgbaImage, map: AlphaMap, gain: number, x0: number, y0: number): Interior {
    const { width, height, data } = image;
    const line = outline(map);
    let peak = 0;
    for (const value of map.values) peak = Math.max(peak, value);
    const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height ? map.values[y * map.width + x] : 0;
    const inImage = (x: number, y: number) => x0 + x >= 0 && y0 + y >= 0 && x0 + x < width && y0 + y < height;
    const after = (x: number, y: number) => restoredBrightness(data, ((y0 + y) * width + x0 + x) * 4, opacity(map, gain, x, y));
    const before = (x: number, y: number) => brightness(data, ((y0 + y) * width + x0 + x) * 4);
    /** Each channel's departure from the pixel's brightness, as removal writes the pixel. */
    const colourAt = (x: number, y: number): number[] => {
        const i = ((y0 + y) * width + x0 + x) * 4, alpha = opacity(map, gain, x, y);
        const channels = [restore(data[i], alpha), restore(data[i + 1], alpha), restore(data[i + 2], alpha)];
        const mean = (channels[0] + channels[1] + channels[2]) / 3;
        return channels.map(v => v - mean);
    };
    const whole = newReadings(), rim = newReadings();
    const sides = DIRECTIONS.map(newReadings);
    const colour: ColourReadings = { real: [], nulls: [] };
    for (let k = 0; k < line.count; k++) {
        const d = line.direction[k];
        const [dx, dy] = DIRECTIONS[d];
        const s = line.step[k];
        const ix = line.ix[k], iy = line.iy[k];
        if (inMap(ix - dx * INSIDE, iy - dy * INSIDE) < peak / 2) continue;
        const predicted = opacity(map, gain, ix, iy) * (255 - before(ix + dx * (s + BEYOND), iy + dy * (s + BEYOND)));
        if (predicted < THRESHOLDS.informative) continue;
        // The reading on the logo, then the same reading moved out onto clean picture.
        for (const shift of [0, 2 * INSIDE + s + BEYOND]) {
            const px = ix + dx * shift, py = iy + dy * shift;
            const deepX = px - dx * INSIDE, deepY = py - dy * INSIDE;
            const refX = px + dx * (s + BEYOND), refY = py + dy * (s + BEYOND);
            const farX = refX + dx * INSIDE, farY = refY + dy * INSIDE;
            const far2X = farX + dx * INSIDE, far2Y = farY + dy * INSIDE;
            if (!inImage(deepX, deepY) || !inImage(far2X, far2Y)) continue;
            if (inMap(refX, refY) > OUTSIDE || inMap(farX, farY) > OUTSIDE || inMap(far2X, far2Y) > OUTSIDE) continue;
            if (shift && inMap(deepX, deepY) > OUTSIDE) continue;
            const ref = after(refX, refY), far = after(farX, farY);
            const outer = ref - far, outer2 = far - after(far2X, far2Y);
            if (Math.abs(outer) > STRAIGHT * predicted || Math.abs(outer2) > STRAIGHT * predicted || Math.abs(outer - outer2) > CURVED * predicted) continue;
            const slope = outer / INSIDE;
            const value = (after(deepX, deepY) - (ref + slope * (s + BEYOND + INSIDE))) / predicted;
            const into = shift ? "nulls" : "real";
            whole[into].push(value);
            sides[d][into].push(value);
            if (!shift) { whole.steps.push(predicted); sides[d].steps.push(predicted); }
            for (let j = 1; j < s; j++) {
                rim[into].push((after(px + dx * j, py + dy * j) - (ref + slope * (s - j + BEYOND))) / predicted);
                if (!shift) rim.steps.push(predicted);
            }
            // The rim's colour (the first core pixel and the pixels out to the first outside one) against the reference's.
            const reference = colourAt(refX, refY).map((v, c) => (v + colourAt(farX, farY)[c]) / 2);
            const tint = [0, 0, 0];
            for (let j = 0; j < s; j++) colourAt(px + dx * j, py + dy * j).forEach((v, c) => { tint[c] += v / s; });
            colour[into].push(tint.map((v, c) => v - reference[c]));
        }
    }
    const typical = median(whole.steps);
    const few = THRESHOLDS.interior;
    return {
        whole: reading(whole, typical),
        sides: sides.map(side => side.real.length >= few.sidePairs ? reading(side, typical) : null),
        rim: rim.real.length >= few.pairs ? reading(rim, typical) : null,
        colour: colourReading(colour),
    };
}

/**
 * Fine detail after removing `removed` (see `Fine`): over its footprint and
 * the layout's usual logo's, and FINE_NEAR pixels around them, against a ring
 * FINE_RING pixels out. Brightness is the three channels' mean.
 */
export function fine(image: RgbaImage, removed: Drawn, layout?: { map: AlphaMap; x: number; y: number }): Fine {
    const { width, height, data } = image;
    const [inner, outer] = FINE_RING;
    const shapes = layout ? [removed, layout] : [removed];
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { map, x, y } of shapes) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + map.width); bottom = Math.max(bottom, y + map.height);
    }
    // The blur reads 3 pixels further than the ring.
    const reach = outer + 3;
    left = Math.max(0, left - reach); top = Math.max(0, top - reach);
    right = Math.min(width, right + reach); bottom = Math.min(height, bottom + reach);
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) return { inside: 0, ring: 0 };
    const n = w * h;
    const values = new Float32Array(n);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((top + y) * width + left + x) * 4;
            values[y * w + x] = restoredBrightness(data, i, opacity(removed.map, removed.gain, left + x - removed.x, top + y - removed.y));
        }
    }
    // Blur across, then down, repeating the edge pixels; detail is what the blur takes away.
    const across = new Float32Array(n);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let d = -3; d <= 3; d++) sum += BLUR[Math.abs(d)] * values[y * w + Math.min(w - 1, Math.max(0, x + d))];
            across[y * w + x] = sum;
        }
    }
    const distance = distances(w, h, (x, y) => shapes.some(s => opacity(s.map, 1, left + x - s.x, top + y - s.y) > OUTSIDE), outer);
    let inSum = 0, inCount = 0, ringSum = 0, ringCount = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const k = y * w + x, d = distance[k];
            if (d < 0 || (d > FINE_NEAR && d < inner)) continue;
            let blurred = 0;
            for (let t = -3; t <= 3; t++) blurred += BLUR[Math.abs(t)] * across[Math.min(h - 1, Math.max(0, y + t)) * w + x];
            const detail = (values[k] - blurred) ** 2;
            if (d <= FINE_NEAR) { inSum += detail; inCount++; } else { ringSum += detail; ringCount++; }
        }
    }
    return { inside: inCount ? Math.sqrt(inSum / inCount) : 0, ring: ringCount ? Math.sqrt(ringSum / ringCount) : 0 };
}

function percentile(values: number[], share: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** Gaussian elimination with partial pivoting on an augmented n × (n + 1) system; a singular one gives zeros. */
function solve(system: Float64Array[]): number[] {
    const n = system.length;
    for (let column = 0; column < n; column++) {
        let pivot = column;
        for (let row = column + 1; row < n; row++) if (Math.abs(system[row][column]) > Math.abs(system[pivot][column])) pivot = row;
        if (Math.abs(system[pivot][column]) < 1e-12) return Array<number>(n).fill(0);
        [system[column], system[pivot]] = [system[pivot], system[column]];
        for (let row = column + 1; row < n; row++) {
            const factor = system[row][column] / system[column][column];
            for (let k = column; k <= n; k++) system[row][k] -= factor * system[column][k];
        }
    }
    const result = Array<number>(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
        let sum = system[row][n];
        for (let k = row + 1; k < n; k++) sum -= system[row][k] * result[k];
        result[row] = sum / system[row][row];
    }
    return result;
}

const limit = ({ floor, share }: { floor: number; share: number }, texture: number) => Math.max(floor, share * texture);

/**
 * Whether what removal leaves over the logo as a whole is within its bounds:
 * no region of it far from the picture's surface beyond the picture's own
 * spread, nothing rougher than the picture around it, and the core, its two
 * middle quadrants together, not darker than the picture's own variation at
 * the logo's scale allows (see `Plateau.coarse`).
 */
export function plateauIsClean(p: Plateau): boolean {
    return Math.abs(p.bump) <= limit(THRESHOLDS.plateau, p.spread) && p.rough <= limit(THRESHOLDS.rough, p.ringRough)
        && -p.core <= limit(THRESHOLDS.core, p.coarse);
}

/** Whether the fine detail removal leaves over the logo is within its bound. */
export function fineIsClean(f: Fine): boolean {
    return f.inside <= limit(THRESHOLDS.fine, f.ring);
}

/**
 * Whether what removal leaves in the core passes, direction by direction:
 * not brighter in three or four directions at once, and not darker in three
 * or four either, by `over` on a logo that was scaled (`scaled`) and
 * otherwise by the larger of the native floor and a share of the picture's
 * fine detail around the logo (`ring`, see `Fine`). The core as a whole,
 * against the picture's variation at the logo's scale, is `plateauIsClean`'s.
 */
export function depthIsClean(depth: number[], scaled: boolean, ring = 0): boolean {
    const sorted = [...depth].sort((a, b) => b - a);
    const darker = scaled ? THRESHOLDS.depth.over : Math.max(THRESHOLDS.depth.native.floor, THRESHOLDS.depth.native.share * ring);
    return sorted[2] <= THRESHOLDS.depth.under && -sorted[1] <= darker;
}

/**
 * Whether what removal leaves in the interior is within its bounds: over the
 * whole logo, on every side that could be read, and along the rim, each
 * against what the picture itself reads as beside the logo (plus the
 * scatter of both readings) and against the picture's fine detail around
 * the logo (`ring`, see `Fine`), under which a remnant does not show; the
 * rim must not read the opposite way from its null by more than their
 * scatter allows; and the rim's colour must stay within `colour` levels of
 * the picture's, or within its own null plus scatter. Too few straight
 * pairs to read the whole logo is not clean: nothing confirms it.
 */
export function interiorIsClean(i: Interior, ring: number, resampled: boolean): boolean {
    const t = THRESHOLDS.interior;
    const bounds = resampled ? t.resampled : t.native;
    const within = (r: Reading, floor: number, share: number) => Math.abs(r.left) <= Math.max(floor, share * (Math.abs(r.nullLeft) + r.scatter), bounds.texture * ring);
    const agrees = (r: Reading, floor: number) => r.left * r.nullLeft >= 0 || Math.abs(r.left) <= floor
        || Math.abs(r.left - r.nullLeft) <= Math.max(floor, t.disagree * r.scatter, bounds.texture * ring);
    if (i.whole.count < t.pairs) return false;
    return within(i.whole, bounds.whole, t.share.whole)
        && i.sides.every(side => side === null || within(side, bounds.side, t.share.side))
        && (i.rim === null || (within(i.rim, bounds.rim, t.share.rim) && agrees(i.rim, bounds.rim)))
        && (i.colour === null || i.colour.left <= Math.max(t.colour, t.share.rim * (i.colour.nullLeft + i.colour.scatter)));
}

/** Whether the residue is under both bounds. */
export function isClean(r: Residue): boolean {
    return r.fill <= limit(THRESHOLDS.fill, r.texture) && r.edge <= limit(THRESHOLDS.edge, r.texture);
}

/** How far over its bounds a residue is: under 1 is clean. Lower is a better fit. */
function badness(r: Residue): number {
    return Math.hypot(r.fill / limit(THRESHOLDS.fill, r.texture), r.edge / limit(THRESHOLDS.edge, r.texture));
}

function opaque(image: RgbaImage, x0: number, y0: number, map: AlphaMap): boolean {
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            if (image.data[((y0 + y) * image.width + x0 + x) * 4 + 3] !== 255) return false;
        }
    }
    return true;
}

/** One way the logo could sit: a placement at one position, size and sub-pixel offset. */
interface Variant {
    placement: Placement;
    map: AlphaMap;
    /** The box's top-left corner in the pixels passed in. */
    x: number;
    y: number;
    /** The logo's exact extent in the whole picture, for its size and margins. */
    left: number;
    top: number;
    scaleX: number;
    scaleY: number;
    /** For a picture scaled from a standard size: how its scaling is modelled. */
    kernel?: Kernel;
}

const SUBPIXEL_OFFSETS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
const SUBPIXEL_SCALES = [0.99, 1, 1.01];

/** Both ways a picture scaled from a standard size is modelled (see `Kernel`). */
const KERNELS: Kernel[] = ["area", "lanczos"];

function* variants(placement: Placement, frame: Frame): Generator<Variant> {
    const capture = MASK_SOURCES[placement.mask].size;
    if (placement.subpixel) {
        for (const kernel of KERNELS) {
            for (const ds of SUBPIXEL_SCALES) {
                for (const dy of SUBPIXEL_OFFSETS) {
                    for (const dx of SUBPIXEL_OFFSETS) {
                        const left = placement.left + dx, top = placement.top + dy;
                        const scaleX = placement.scaleX * ds, scaleY = placement.scaleY * ds;
                        const placed = (kernel === "lanczos" ? placedLanczos : placedAlpha)(placement.mask, left, top, scaleX, scaleY);
                        yield { placement, map: placed.map, x: placed.x - frame.left, y: placed.y - frame.top, left, top, scaleX, scaleY, kernel };
                    }
                }
            }
        }
        return;
    }
    const nominal = Math.round(capture * placement.scaleX);
    // The right and bottom margins stay put while the size varies.
    const right = placement.left + nominal, bottom = placement.top + nominal;
    for (let size = nominal - placement.sizeSearch; size <= nominal + placement.sizeSearch; size++) {
        const map = alphaFor(placement.mask, size);
        for (let dy = -placement.search; dy <= placement.search; dy++) {
            for (let dx = -placement.search; dx <= placement.search; dx++) {
                const left = right - size + dx, top = bottom - size + dy;
                yield { placement, map, x: left - frame.left, y: top - frame.top, left, top, scaleX: size / capture, scaleY: size / capture };
            }
        }
    }
}

interface Candidate {
    variant: Variant;
    evidence: Evidence;
    gain: number;
    residue: Residue;
    badness: number;
}

/** A candidate with its opacity fitted and every check made on what its removal would leave. */
interface Checked extends Candidate {
    layoutResidue: Residue;
    plateau: Plateau;
    fine: Fine;
    depth: number[];
    interior: Interior;
    opacityInRange: boolean;
    clean: boolean;
}

/** The least opacity a layout's logo may fit at, as a multiple of the layout's usual one. */
function opacityFloor(placement: Placement): number {
    return placement.family === "inset-96" ? THRESHOLDS.opacity.floor["inset-96"] : THRESHOLDS.opacity.floor.other;
}

/** The greatest opacity a layout's logo may fit at, as a multiple of the layout's usual one. */
function opacityCeiling(placement: Placement): number {
    return placement.family === "inset-96" ? THRESHOLDS.opacity.ceiling["inset-96"] : THRESHOLDS.opacity.ceiling.other;
}

/**
 * Whether the fit takes the logo to have been scaled after Gemini drew it, with a kernel that is not known: a
 * picture scaled from a standard size, or a logo a pixel off its layout's size.
 */
function isScaled(variant: Variant): boolean {
    return variant.placement.subpixel || variant.map.width !== Math.round(MASK_SOURCES[variant.placement.mask].size * variant.placement.scaleX);
}

/** The layout's usual logo, at its usual opacity, in the pixels passed in. */
function usual(placement: Placement, frame: Frame, kernel: Kernel = "area"): Drawn {
    if (placement.subpixel) {
        const placed = (kernel === "lanczos" ? placedLanczos : placedAlpha)(placement.mask, placement.left, placement.top, placement.scaleX, placement.scaleY);
        return { map: placed.map, x: placed.x - frame.left, y: placed.y - frame.top, gain: placement.gain };
    }
    const size = Math.round(MASK_SOURCES[placement.mask].size * placement.scaleX);
    return { map: alphaFor(placement.mask, size), x: placement.left - frame.left, y: placement.top - frame.top, gain: placement.gain };
}

/**
 * Everything removal would leave: at the fit's own outline, at the outline
 * of the layout's usual logo, over the logo as a whole, in its fine detail,
 * in its core and in its interior against the picture beyond the outline;
 * and whether the fitted opacity lies in the range the layout is drawn
 * with. Only a fit that passes all seven is clean.
 */
function check(image: RgbaImage, candidate: Candidate, frame: Frame): Checked {
    const { variant, gain } = candidate;
    const removed: Drawn = { map: variant.map, x: variant.x, y: variant.y, gain };
    const layout = usual(variant.placement, frame, variant.kernel);
    const sameAsLayout = layout.map === variant.map && layout.x === variant.x && layout.y === variant.y;
    const layoutResidue = sameAsLayout ? candidate.residue : residue(image, variant.map, gain, variant.x, variant.y, layout);
    const leftOver = plateau(image, removed, sameAsLayout ? undefined : layout);
    const detail = fine(image, removed, sameAsLayout ? undefined : layout);
    const depth = depthResidue(image, variant.map, gain, variant.x, variant.y);
    const inside = interior(image, variant.map, gain, variant.x, variant.y);
    const opacityInRange = gain >= opacityFloor(variant.placement) * variant.placement.gain && gain <= opacityCeiling(variant.placement) * variant.placement.gain;
    const resampled = isScaled(variant) || !isStandardSize(frame.width, frame.height);
    const clean = opacityInRange && isClean(candidate.residue) && isClean(layoutResidue) && plateauIsClean(leftOver)
        && fineIsClean(detail) && depthIsClean(depth, isScaled(variant), detail.ring) && interiorIsClean(inside, detail.ring, resampled);
    return { ...candidate, layoutResidue, plateau: leftOver, fine: detail, depth, interior: inside, opacityInRange, clean };
}

function judge(image: RgbaImage, variant: Variant, evidence: Evidence, gain: number): Candidate {
    const r = residue(image, variant.map, gain, variant.x, variant.y);
    return { variant, evidence, gain, residue: r, badness: badness(r) };
}

/**
 * The opacity that leaves no step across the outline, found by halving the
 * interval where the step left changes sign. Too little opacity leaves the
 * logo brighter than its surroundings, too much cuts it in darker, so the
 * step falls as the opacity rises. Any residue left at that opacity is the
 * fit's to answer for.
 */
function fitOpacity(image: RgbaImage, variant: Variant, evidence: Evidence): Candidate {
    const stepLeft = (gain: number) => residue(image, variant.map, gain, variant.x, variant.y).step;
    const start = variant.placement.gain * evidence.ratio;
    let low = start * GAIN_RANGE[0], high = start * GAIN_RANGE[1];
    let lowStep = stepLeft(low), highStep = stepLeft(high);
    if (lowStep <= 0) return judge(image, variant, evidence, low);
    if (highStep > 0) return judge(image, variant, evidence, high);
    // The least opacity that leaves no step. Over black, more than that writes
    // the same clamped pixels, so the step stays at 0 above it; this finds its start.
    for (let i = 0; i < GAIN_HALVINGS; i++) {
        const middle = (low + high) / 2, step = stepLeft(middle);
        if (step > 0) { low = middle; lowStep = step; } else { high = middle; highStep = step; }
    }
    return judge(image, variant, evidence, low + (high - low) * lowStep / (lowStep - highStep));
}

interface Area { left: number; top: number; right: number; bottom: number }

/** The box that holds every one of these fits, with 2 pixels around it, inside the image. */
function around(fits: Variant[], image: RgbaImage): Area {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { x, y, map } of fits) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + map.width); bottom = Math.max(bottom, y + map.height);
    }
    return { left: Math.max(0, left - 2), top: Math.max(0, top - 2), right: Math.min(image.width, right + 2), bottom: Math.min(image.height, bottom + 2) };
}

/** Sum of squared brightness differences between neighbouring pixels of the area, as removal would write them. */
function roughness(image: RgbaImage, candidate: Candidate, area: Area): number {
    const { data, width } = image;
    const { map, x: x0, y: y0 } = candidate.variant;
    const w = area.right - area.left, h = area.bottom - area.top;
    const values = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const gx = area.left + x, gy = area.top + y;
            values[y * w + x] = restoredBrightness(data, (gy * width + gx) * 4, opacity(map, candidate.gain, gx - x0, gy - y0));
        }
    }
    let sum = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = values[y * w + x];
            if (x + 1 < w) sum += (values[y * w + x + 1] - v) ** 2;
            if (y + 1 < h) sum += (values[(y + 1) * w + x] - v) ** 2;
        }
    }
    return sum;
}

/** The largest reading the interior check sees for a fit, in levels: over the whole logo, on any side or along the rim. */
function remnant(c: Checked): number {
    const { whole, sides, rim } = c.interior;
    return Math.max(Math.abs(whole.left), ...sides.map(side => side ? Math.abs(side.left) : 0), rim ? Math.abs(rim.left) : 0);
}

/**
 * The Lanczos model of a resized copy is chosen over the model of Gemini's own scaling only where its best clean
 * fit's outline match is higher by more than this. A level of noise moves a match by about 0.02.
 */
const MODEL_MARGIN = 0.05;

/** 0 for a logo at its layout's own size, 1 for one scaled as Gemini scales, 2 for the Lanczos model of a resized copy. */
function simplicity(c: Checked): number {
    return !isScaled(c.variant) ? 0 : c.variant.kernel === "lanczos" ? 2 : 1;
}

const wholeImage = (image: RgbaImage): Frame => ({ width: image.width, height: image.height, left: 0, top: 0 });

/** Every fit of the best-matching layout that was shortlisted and checked, and whether the logo reads too faint to use any. */
interface Ranked {
    fitted: Checked[];
    faint: boolean;
}

/**
 * Where the logo could be, judged: every placement's variants are measured
 * for the logo's presence, the best-matching layout's are shortlisted and
 * each shortlisted fit has its opacity fitted and every check made.
 */
function rank(image: RgbaImage, frame: Frame): Ranked | null {
    const found: { variant: Variant; evidence: Evidence }[] = [];
    for (const placement of sparklePlacements(frame.width, frame.height)) {
        for (const variant of variants(placement, frame)) {
            const { map, x, y } = variant;
            if (x < 0 || y < 0 || x + map.width > image.width || y + map.height > image.height) continue;
            // Gemini's logo sits on opaque pixels; a see-through corner is not its work.
            if (!opaque(image, x, y, map)) continue;
            const evidence = measure(image, map, placement.gain, x, y);
            if (passes(evidence)) found.push({ variant, evidence });
        }
    }
    if (!found.length) return null;
    // Which logo and layout: the best outline match decides. Where exactly: among that layout's fits that
    // match nearly as well, each with its opacity fitted, the clean one whose result is smoothest. All of
    // them are judged on the same pixels, so the picture's own texture weighs the same on each and only
    // the fit tells them apart. With none clean, the one that leaves least behind is reported. A scaled
    // picture's two models are shortlisted separately (native fits go with the averaged one), so the
    // one that matches a little better on the outline cannot crowd the other out before both are checked.
    found.sort((a, b) => b.evidence.match - a.evidence.match);
    // The layout is decided by the logo as Gemini draws it; the Lanczos model of a resized copy only refines the fit.
    const { family } = (found.find(c => c.variant.kernel !== "lanczos") ?? found[0]).variant.placement;
    const inFamily = found.filter(c => c.variant.placement.family === family);
    // The Lanczos model is tried only where it matches the logo's outline at least as well as the logo as Gemini
    // draws it: a copy resized in an editor. Over strong texture another model can pass the checks by chance.
    const bestMatch = (lanczos: boolean) => Math.max(0, ...inFamily.filter(c => (c.variant.kernel === "lanczos") === lanczos).map(c => c.evidence.match));
    const lanczosFits = bestMatch(true) >= bestMatch(false);
    const shortlist = [...new Set(inFamily.map(c => c.variant.kernel ?? "area"))].filter(kernel => kernel !== "lanczos" || lanczosFits).flatMap(kernel => {
        const ofKernel = inFamily.filter(c => (c.variant.kernel ?? "area") === kernel);
        const top = ofKernel[0].evidence.match;
        return ofKernel.filter(c => c.evidence.match >= SHORTLIST_MATCH * top).slice(0, SHORTLIST);
    });
    const fitted = shortlist.map(({ variant, evidence }) => check(image, fitOpacity(image, variant, evidence), frame));
    // How strong the logo is, is read where it matches best. If that reads under the layout's floor (a logo
    // softened, or fainter than Gemini draws it), no fit is used: one that reads stronger elsewhere is the wrong one.
    const strongest = fitted.reduce((a, b) => b.evidence.match > a.evidence.match ? b : a);
    const faint = strongest.gain < opacityFloor(strongest.variant.placement) * strongest.variant.placement.gain;
    return { fitted, faint };
}

/** One shortlisted fit as `rankFits` reports it, for tests and local tooling. */
export interface RankedFit extends Geometry {
    family: Family;
    kernel?: Kernel;
    x: number;
    y: number;
    match: number;
    gain: number;
    clean: boolean;
    /** The largest interior reading (see `interior`), in levels. */
    remnant: number;
    /** 0 for an unscaled fit, 1 for one scaled as Gemini scales, 2 for the Lanczos model. */
    simplicity: number;
    /** How rough removal would leave the area holding every clean fit; lower is smoother. */
    roughness: number;
    chosen: boolean;
}

/** Every shortlisted fit, judged, in the order they were checked; empty when the logo is not there. Reads pixels and changes nothing. */
export function rankFits(image: RgbaImage, frame: Frame = wholeImage(image)): RankedFit[] {
    const ranked = rank(image, frame);
    if (!ranked) return [];
    const chosen = findSparkle(image, frame);
    const clean = ranked.fitted.filter(c => c.clean);
    const area = around((clean.length ? clean : ranked.fitted).map(c => c.variant), image);
    return ranked.fitted.map(c => {
        const box = placementBox({ ...c.variant.placement, left: c.variant.left, top: c.variant.top, scaleX: c.variant.scaleX, scaleY: c.variant.scaleY }, frame.width, frame.height);
        return {
            family: c.variant.placement.family, kernel: c.variant.kernel, x: c.variant.x + frame.left, y: c.variant.y + frame.top, ...box,
            match: c.evidence.match, gain: c.gain, clean: c.clean, remnant: remnant(c), simplicity: simplicity(c), roughness: roughness(image, c, area),
            chosen: chosen !== null && chosen.x === c.variant.x + frame.left && chosen.y === c.variant.y + frame.top && chosen.map === c.variant.map && chosen.gain === c.gain,
        };
    });
}

/**
 * The logo, fitted, or null when it is not there. Reads pixels and changes
 * nothing. A fit that removal would not leave clean comes back with `clean`
 * false. Positions in the result are in the whole picture's coordinates.
 */
export function findSparkle(image: RgbaImage, frame: Frame = wholeImage(image)): Fit | null {
    const ranked = rank(image, frame);
    if (!ranked) return null;
    const { fitted, faint } = ranked;
    const clean = faint ? [] : fitted.filter(c => c.clean);
    let best: Checked;
    if (clean.length) {
        // The simplest explanation first: where a logo at its layout's own size, unscaled, comes out clean (a
        // cropped copy, say), a scaled model that happens to come out smoother does not replace it. Among scaled
        // fits, the Lanczos model of a resized copy is used only where its outline matches clearly better than
        // the logo as Gemini's own scaling draws it; a choice made on smoothness alone flipped between the two
        // on a level of noise, and their results differ by several levels. Within the chosen tier the smoothest
        // result wins: a fit a fraction of a pixel off its logo leaves ridges at the edge that smoothness sees
        // even over texture, where the interior readings are too noisy to.
        const unscaled = clean.filter(c => !isScaled(c.variant));
        const bestMatch = (lanczos: boolean) => Math.max(0, ...clean.filter(c => (c.variant.kernel === "lanczos") === lanczos).map(c => c.evidence.match));
        const kernel: Kernel = bestMatch(true) > bestMatch(false) + MODEL_MARGIN || bestMatch(false) === 0 ? "lanczos" : "area";
        const tier = unscaled.length ? unscaled : clean.filter(c => (c.variant.kernel === "lanczos") === (kernel === "lanczos"));
        const area = around(clean.map(c => c.variant), image);
        best = tier.reduce((a, b) => roughness(image, b, area) < roughness(image, a, area) ? b : a);
    } else {
        best = fitted.reduce((a, b) => b.badness < a.badness ? b : a);
    }
    const { variant, evidence, gain } = best;
    const box = placementBox({ ...variant.placement, left: variant.left, top: variant.top, scaleX: variant.scaleX, scaleY: variant.scaleY }, frame.width, frame.height);
    return {
        family: variant.placement.family,
        kernel: variant.kernel,
        mask: variant.placement.mask,
        x: variant.x + frame.left,
        y: variant.y + frame.top,
        map: variant.map,
        gain,
        size: box.size,
        marginRight: box.marginRight,
        marginBottom: box.marginBottom,
        layout: placementBox(variant.placement, frame.width, frame.height),
        evidence,
        residue: best.residue,
        layoutResidue: best.layoutResidue,
        plateau: best.plateau,
        fine: best.fine,
        depth: best.depth,
        interior: best.interior,
        opacityInRange: best.opacityInRange,
        clean: best.clean && !faint,
    };
}

/**
 * Reverse the blend inside the fitted logo's footprint, in place. Pixels
 * with no logo opacity, and everything outside the logo's box, are not
 * touched; a Lanczos-scaled logo's box includes the thin overshoot just
 * outside its edge, which is put back too.
 */
export function removeSparkle(image: RgbaImage, fit: Fit, frame: Frame = wholeImage(image)): void {
    const { map, gain } = fit;
    const x0 = fit.x - frame.left, y0 = fit.y - frame.top;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            const alpha = opacity(map, gain, x, y);
            if (alpha === 0) continue;
            const i = ((y0 + y) * image.width + x0 + x) * 4;
            image.data[i] = restore(image.data[i], alpha);
            image.data[i + 1] = restore(image.data[i + 1], alpha);
            image.data[i + 2] = restore(image.data[i + 2], alpha);
        }
    }
}
