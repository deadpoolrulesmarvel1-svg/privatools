/**
 * Detection, fitting and removal on neutral synthetic pictures.
 *
 * Tolerance: under the logo, every channel of every pixel comes back within
 * 3 levels (of 255) of the original. Gemini rounds alpha · 255 + (1 − alpha)
 * · original to 8 bits, and dividing that rounding error by (1 − alpha) can
 * move the result by one level; the opacity is fitted from the picture, to
 * within 1 % over flat colour and about 2.5 % over texture, which can add up
 * to two more where the logo is strongest. The small 36 px logo has a
 * quarter of the outline to fit from, so over texture it is allowed 4. Over
 * strong per-pixel grain (standard deviation about 12 levels) the fit is
 * looser, so there the mean error must stay under 4 levels. Outside the
 * logo's footprint nothing changes at all.
 */
import { describe, expect, it } from "vitest";
import { alphaFor, placedAlpha, placedLanczos, type AlphaMap, type Kernel } from "./alpha";
import { depthIsClean, depthResidue, findSparkle, fine, fineIsClean, measure, passes, plateau, plateauIsClean, removeSparkle, type Fit, type Frame, type RgbaImage } from "./detect";
import { sparklePlacements, sparkleRegion, type Family, type Placement } from "./geometry";
import { MASK_SOURCES, type MaskId } from "./masks";
import { BACKGROUNDS, SHAPES, SMOOTH, applySparkle, background, clone, glare, jpegLike, paintShape, random, resized, smooth, solid, veil, type Background } from "@/test/gemini-fixtures";

interface Scene { image: RgbaImage; frame: Frame }
interface Box { x: number; y: number; width: number; height: number }

/** The corner of a width × height picture that detection reads, filled with a synthetic background. */
function corner(width: number, height: number, kind: Background, seed = 1): Scene {
    const region = sparkleRegion(width, height)!;
    return { image: background(kind, region.width, region.height, seed), frame: { width, height, left: region.left, top: region.top } };
}

function placement(width: number, height: number, family: Family, which = 0): Placement {
    const found = sparklePlacements(width, height).filter(p => p.family === family)[which];
    if (!found) throw new Error(`no ${family} placement on ${width} × ${height}`);
    return found;
}

interface Logo { map: AlphaMap; box: Box; gain: number }

/**
 * The logo a placement describes, moved by (dx, dy), at `size` px for a native one, at `gain` times the layout's
 * opacity; a scaled one as Gemini's own scaling draws it, or as a Lanczos resize does (`kernel`).
 */
function logo(p: Placement, { dx = 0, dy = 0, size, gain = 1, mask = p.mask, kernel = "area" }: { dx?: number; dy?: number; size?: number; gain?: number; mask?: MaskId; kernel?: Kernel } = {}): Logo {
    if (p.subpixel) {
        const placed = (kernel === "lanczos" ? placedLanczos : placedAlpha)(mask, p.left + dx, p.top + dy, p.scaleX, p.scaleY);
        return { map: placed.map, box: { x: placed.x, y: placed.y, width: placed.map.width, height: placed.map.height }, gain: p.gain * gain };
    }
    const nominal = Math.round(MASK_SOURCES[p.mask].size * p.scaleX);
    const s = size ?? nominal;
    // The margins stay put when the size changes.
    const x = p.left + nominal - s + dx, y = p.top + nominal - s + dy;
    return { map: alphaFor(mask, s), box: { x, y, width: s, height: s }, gain: p.gain * gain };
}

function paint(scene: Scene, l: Logo): RgbaImage {
    return applySparkle(scene.image, l.map, l.box.x - scene.frame.left, l.box.y - scene.frame.top, l.gain);
}

/** Largest and mean channel difference inside the box (in the scene's pixels), and the largest outside it. */
function compare(before: RgbaImage, after: RgbaImage, box: Box, frame: Frame) {
    let inside = 0, outside = 0, sum = 0, count = 0;
    for (let y = 0; y < before.height; y++) {
        for (let x = 0; x < before.width; x++) {
            const i = (y * before.width + x) * 4;
            let diff = 0;
            for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(before.data[i + c] - after.data[i + c]));
            const gx = x + frame.left, gy = y + frame.top;
            const inBox = gx >= box.x && gx < box.x + box.width && gy >= box.y && gy < box.y + box.height;
            if (inBox) { inside = Math.max(inside, diff); sum += diff; count++; } else outside = Math.max(outside, diff);
        }
    }
    return { inside, mean: count ? sum / count : 0, outside };
}

/** Remove the fit, then compare with the clean picture over the box that holds both the drawn logo and the fit. */
function removeAndCompare(scene: Scene, marked: RgbaImage, fit: Fit, box: Box) {
    const cleaned = clone(marked);
    removeSparkle(cleaned, fit, scene.frame);
    const left = Math.min(box.x, fit.x), top = Math.min(box.y, fit.y);
    const right = Math.max(box.x + box.width, fit.x + fit.map.width), bottom = Math.max(box.y + box.height, fit.y + fit.map.height);
    return compare(scene.image, cleaned, { x: left, y: top, width: right - left, height: bottom - top }, scene.frame);
}

/** Never a removal that leaves a trace: either nothing found, or a fit that says it would not come out cleanly. */
const neverClaimed = (fit: Fit | null) => fit === null || !fit.clean;

// Each layout at sizes where Gemini uses it, on both sides of the 1024 px threshold,
// with the small logo's canonical aspect ratios and a picture scaled from a standard size.
const LAYOUTS: [number, number, Family, number][] = [
    [1024, 1024, "corner-32", 0], [1024, 1024, "inset-96", 0], [1024, 1024, "proportional", 0],
    [848, 1264, "inset-96", 0], [848, 1264, "corner-32", 0], [1408, 768, "corner-32", 0],
    [1376, 768, "inset-96", 0], [1376, 768, "proportional", 0],
    [720, 1456, "inset-96", 0], [1024, 768, "inset-96", 1],
    [1024, 572, "proportional", 0], [572, 1024, "proportional", 0],
    [1025, 1025, "corner-64", 0], [2752, 1536, "corner-64", 0], [2752, 1536, "corner-192", 0],
];

/** A logo this faint over near-white adds only a few levels; it may be missed there, but never misjudged. */
const faintOver = (kind: Background, p: Placement) => kind === "flat-pale" && p.gain < 1;
/**
 * Over strong per-pixel grain (standard deviation about 12 levels) the small 36 px logo's core reads too noisily
 * for the core check to certify, so it may be found and left unchanged; it is still found, as the right layout.
 */
const noisySmall = (kind: Background, p: Placement) => kind === "noise" && MASK_SOURCES[p.mask].size * p.scaleX < 40;
/** Backgrounds where the logo's opacity is fully determined: flat colour well away from white, and a smooth gradient. */
const DETERMINED: Background[] = ["flat-navy", "flat-orange", "flat-black", "gradient"];

/** The removal error allowed under the logo (see the tolerance at the top). */
function expectClose(kind: Background, error: { inside: number; mean: number; outside: number }, label: string, largest = 3) {
    if (kind === "noise") expect(error.mean, `${label}: mean error under the logo`).toBeLessThan(4);
    else expect(error.inside, `${label}: largest error under the logo`).toBeLessThanOrEqual(largest);
    expect(error.outside, `${label}: change outside the logo`).toBe(0);
}

describe("removing the Gemini sparkle", () => {
    for (const [width, height, family, which] of LAYOUTS) {
        it(`finds, fits and removes the ${family} logo on a ${width} × ${height} image over every background`, () => {
            const p = placement(width, height, family, which);
            const target = logo(p);
            for (const kind of BACKGROUNDS) {
                const scene = corner(width, height, kind, width + height);
                const marked = paint(scene, target);
                const fit = findSparkle(marked, scene.frame);
                if (faintOver(kind, p) && fit === null) continue;
                expect(fit, kind).not.toBeNull();
                expect(fit!.family, kind).toBe(family);
                if (noisySmall(kind, p) && !fit!.clean) continue;
                expect(fit!.clean, `${kind} clean`).toBe(true);
                // A scaled logo's box can start a pixel away from where it was drawn: its edge falls between pixels.
                const slack = p.subpixel ? 1 : 0;
                expect(Math.abs(fit!.x - target.box.x), `${kind} x`).toBeLessThanOrEqual(slack);
                expect(Math.abs(fit!.y - target.box.y), `${kind} y`).toBeLessThanOrEqual(slack);
                if (DETERMINED.includes(kind)) expect(Math.abs(fit!.gain / target.gain - 1), `${kind} opacity`).toBeLessThan(0.01);
                expectClose(kind, removeAndCompare(scene, marked, fit!, target.box), kind);
            }
        }, 60_000);
    }

    it("fits the opacity of a logo fainter or stronger than the layout's usual one", () => {
        const p = placement(1024, 1024, "inset-96");
        // Real logos 96 px in fit 0.98 to 1.19 times the layout's opacity; under 0.9 times is refused (see below).
        for (const gain of [0.92, 1.15]) {
            for (const kind of ["photo", "gradient", "flat-navy"] as const) {
                const scene = corner(1024, 1024, kind, 4);
                const target = logo(p, { gain });
                const marked = paint(scene, target);
                const fit = findSparkle(marked, scene.frame)!;
                expect(fit.clean, `${gain} on ${kind}`).toBe(true);
                expect(Math.abs(fit.gain / target.gain - 1), `${gain} on ${kind}`).toBeLessThan(kind === "photo" ? 0.025 : 0.01);
                expectClose(kind, removeAndCompare(scene, marked, fit, target.box), `${gain} on ${kind}`);
            }
        }
    }, 60_000);

    it("finds the 48 px logo a pixel or two larger or smaller, keeping its margins", () => {
        const p = placement(848, 1264, "inset-96");
        for (const size of [46, 47, 49, 50]) {
            const scene = corner(848, 1264, "photo", size);
            const target = logo(p, { size });
            const marked = paint(scene, target);
            const fit = findSparkle(marked, scene.frame)!;
            expect({ size: fit.size, marginRight: fit.marginRight, marginBottom: fit.marginBottom, clean: fit.clean }, `${size} px`).toEqual({ size, marginRight: 96, marginBottom: 96, clean: true });
            expectClose("photo", removeAndCompare(scene, marked, fit, target.box), `${size} px`);
        }
    }, 60_000);

    it("finds the scaled logo a fraction of a pixel from its projected position, as Gemini scales it or as a Lanczos resize does", () => {
        const p = placement(1024, 768, "inset-96", 1);
        for (const kernel of ["area", "lanczos"] as const) {
            for (const [dx, dy] of [[-0.5, 0.25], [0.75, -0.5], [0.25, 1]]) {
                const label = `${kernel} ${dx}, ${dy}`;
                const scene = corner(1024, 768, "gradient", 3);
                const target = logo(p, { dx, dy, kernel });
                const marked = paint(scene, target);
                const fit = findSparkle(marked, scene.frame)!;
                expect({ family: fit.family, kernel: fit.kernel, clean: fit.clean }, label).toEqual({ family: "inset-96", kernel, clean: true });
                expect(Math.abs(fit.size - 41), `${label} size`).toBeLessThanOrEqual(1);
                expect(Math.abs(fit.marginRight - (1024 - (p.left + dx) - 48 * p.scaleX)), `${label} margin`).toBeLessThanOrEqual(1);
                expectClose("gradient", removeAndCompare(scene, marked, fit, target.box), label);
            }
        }
    }, 60_000);

    it("finds the small logo a few pixels from its formula position, where rounding put it", () => {
        const p = placement(1024, 559, "proportional");
        for (const [dx, dy] of [[2, -1], [-3, 3], [0, 2]]) {
            const scene = corner(1024, 559, "photo", 7);
            const target = logo(p, { dx, dy });
            const marked = paint(scene, target);
            const fit = findSparkle(marked, scene.frame)!;
            expect({ x: fit.x, y: fit.y, clean: fit.clean }).toEqual({ x: target.box.x, y: target.box.y, clean: true });
            expectClose("photo", removeAndCompare(scene, marked, fit, target.box), `${dx}, ${dy}`, 4);
        }
    }, 60_000);

    it("works on a whole picture as well as on its corner", () => {
        const original = background("photo", 1024, 1024, 3);
        const target = logo(placement(1024, 1024, "inset-96"));
        const marked = applySparkle(original, target.map, target.box.x, target.box.y, target.gain);
        const fit = findSparkle(marked)!;
        expect(fit).toMatchObject({ family: "inset-96", x: 880, y: 880, size: 48, marginRight: 96, marginBottom: 96, clean: true });
        removeSparkle(marked, fit);
        expectClose("photo", compare(original, marked, target.box, { width: 1024, height: 1024, left: 0, top: 0 }), "whole picture");
    });

    it("reads pixels without changing them while it looks", () => {
        const scene = corner(1024, 1024, "gradient");
        const marked = paint(scene, logo(placement(1024, 1024, "corner-32")));
        const copy = clone(marked);
        findSparkle(marked, scene.frame);
        expect(marked.data).toEqual(copy.data);
    });
});

describe("never claiming a removal that leaves a trace", () => {
    it("does not claim a logo much fainter than the layout's, which is how a softened copy's logo reads", () => {
        for (const [width, height, family] of [[1024, 1024, "inset-96"], [1024, 1024, "corner-32"]] as const) {
            const p = placement(width, height, family);
            for (const gain of family === "inset-96" ? [0.8, 0.85] : [0.85, 0.9]) {
                for (const kind of ["photo", "flat-navy", "gradient"] as const) {
                    const scene = corner(width, height, kind, 11);
                    const fit = findSparkle(paint(scene, logo(p, { gain })), scene.frame);
                    expect(neverClaimed(fit), `${family} at ${gain}× on ${kind}`).toBe(true);
                }
            }
        }
    }, 60_000);

    it("does not claim a logo much stronger than the layout's", () => {
        for (const [width, height, family, which] of LAYOUTS) {
            const p = placement(width, height, family, which);
            for (const gain of [1.6, 2]) {
                for (const kind of ["photo", "flat-navy", "gradient"] as const) {
                    const scene = corner(width, height, kind, 13);
                    const fit = findSparkle(paint(scene, logo(p, { gain })), scene.frame);
                    expect(neverClaimed(fit), `${family} ${width} × ${height} at ${gain}× on ${kind}`).toBe(true);
                }
            }
        }
    }, 120_000);

    it("does not claim a logo of the wrong size or shape where the layout fixes both", () => {
        const p = placement(1024, 1024, "corner-32");
        for (const kind of ["photo", "flat-navy", "flat-grey", "gradient"] as const) {
            const scene = corner(1024, 1024, kind, 17);
            for (const size of [44, 46, 50, 52]) {
                const fit = findSparkle(paint(scene, logo(p, { size })), scene.frame);
                expect(neverClaimed(fit) || fit!.size === size, `${size} px on ${kind}`).toBe(true);
            }
            // The paler large logo's shape, shrunk to 48 px, where the 48 px capture's belongs.
            const fit = findSparkle(paint(scene, logo(p, { mask: "v2-96" })), scene.frame);
            expect(neverClaimed(fit) || fit!.mask === "v2-96", `v2-96 shape on ${kind}`).toBe(true);
        }
    }, 60_000);
});

describe("copies saved again or resized after Gemini made them", () => {
    /**
     * Over a flat colour any copy of the logo left behind shows, so these are
     * the hardest cases for the residue checks. JPEG re-compression softens the
     * logo's edges; a resize moves them by a fraction of a pixel, and Lanczos
     * adds an overshoot. Either way the logo no longer matches its calibrated
     * outline, and a fit can settle on a smaller logo at a lower opacity (or a
     * stronger one) that leaves no step at its own outline, while a faint copy
     * of the real logo, or a thin outline of it, remains.
     */
    const DEGRADED: [string, (image: RgbaImage) => RgbaImage, number][] = [
        ["saved as JPEG at quality 95", image => jpegLike(image, 95), 1],
        ["saved as JPEG at quality 85", image => jpegLike(image, 85), 1],
        ["saved as JPEG at quality 75", image => jpegLike(image, 75), 1],
        ["shrunk to 98 % with Lanczos", image => resized(image, 0.98, "lanczos"), 0.98],
        ["shrunk to 98 % with a linear filter", image => resized(image, 0.98), 0.98],
    ];
    const COLOURS: [number, number, number][] = [[186, 220, 74], [128, 128, 128], [230, 200, 160]];

    /**
     * What a removal left against the flat colour around it: the mean over the
     * real logo's core and over its footprint, and the largest difference in
     * any one channel in the footprint or 2 pixels around it (a thin outline).
     */
    function leftOver(cleaned: RgbaImage, logo: { map: AlphaMap; x: number; y: number }) {
        const flat = (4 * cleaned.width + 4) * 4;
        const lum = (i: number) => (cleaned.data[i] + cleaned.data[i + 1] + cleaned.data[i + 2]) / 3;
        const peak = logo.map.values.reduce((max, value) => Math.max(max, value), 0);
        let core = 0, coreCount = 0, footprint = 0, footprintCount = 0, largest = 0;
        for (let y = -2; y < logo.map.height + 2; y++) {
            for (let x = -2; x < logo.map.width + 2; x++) {
                const i = ((logo.y + y) * cleaned.width + logo.x + x) * 4;
                for (let c = 0; c < 3; c++) largest = Math.max(largest, Math.abs(cleaned.data[i + c] - cleaned.data[flat + c]));
                const inside = x >= 0 && y >= 0 && x < logo.map.width && y < logo.map.height;
                const alpha = inside ? logo.map.values[y * logo.map.width + x] : 0;
                if (alpha < 0.05 * peak) continue;
                const difference = lum(i) - lum(flat);
                footprint += difference; footprintCount++;
                if (alpha >= peak / 2) { core += difference; coreCount++; }
            }
        }
        return { core: core / coreCount, footprint: footprint / footprintCount, largest };
    }

    it("never reports a removal that leaves a copy or an outline of the logo over flat colour", () => {
        let found = 0;
        const claims: string[] = [];
        for (const [width, height] of [[480, 480], [400, 640]]) {
            for (const colour of COLOURS) {
                for (const [label, degrade, factor] of DEGRADED) {
                    // The whole picture is degraded, so the JPEG blocks and the resize act on it as an app's would.
                    const marked = degrade(applySparkle(solid(width, height, colour), alphaFor("v1-48", 48), width - 144, height - 144, 0.6));
                    const fit = findSparkle(marked);
                    if (!fit) continue;
                    found++;
                    if (!fit.clean) continue;
                    const cleaned = clone(marked);
                    removeSparkle(cleaned, fit);
                    const truth = placedAlpha("v1-48", (width - 144) * factor, (height - 144) * factor, factor, factor);
                    const { core, footprint, largest } = leftOver(cleaned, truth);
                    // JPEG leaves its own noise of a level or two in flat colour; more than 4 in one channel is something else.
                    if (Math.abs(core) > 2 || Math.abs(footprint) > 2 || largest > 4) {
                        claims.push(`${width} × ${height} [${colour}] ${label}: removed as ${fit.size} px at ${fit.marginRight}, opacity ${fit.gain.toFixed(2)}, leaving ${core.toFixed(1)} levels in the core and up to ${largest} in one channel`);
                    }
                }
            }
        }
        // The logo is still there to be found in most of them; what matters is what is claimed.
        expect(found).toBeGreaterThan(20);
        expect(claims).toEqual([]);
    }, 120_000);

    it("judges what removal would leave over the logo as a whole, region by region", () => {
        const [width, height] = [480, 480];
        const truth = logo(placement(width, height, "inset-96"));
        const image = applySparkle(solid(width, height, [186, 220, 74]), truth.map, truth.box.x, truth.box.y, truth.gain);
        const layout = { map: truth.map, x: truth.box.x, y: truth.box.y };
        const fit = (gain: number, size = 48) => ({ map: alphaFor("v1-48", size), x: truth.box.x + (48 - size) / 2, y: truth.box.y + (48 - size) / 2, gain });
        // The right logo at its own opacity leaves nothing.
        const exact = plateau(image, fit(0.6), layout);
        expect(Math.abs(exact.bump)).toBeLessThan(1);
        expect(plateauIsClean(exact)).toBe(true);
        // Too faint a fit leaves a copy of the logo, too strong a one cuts a dark copy in.
        const faint = plateau(image, fit(0.45), layout);
        expect(faint.bump).toBeGreaterThan(3);
        expect(plateauIsClean(faint)).toBe(false);
        const strong = plateau(image, fit(0.75), layout);
        expect(strong.bump).toBeLessThan(-3);
        expect(plateauIsClean(strong)).toBe(false);
        // A fit 2 px small at the right opacity leaves the real logo's rim, a thin outline.
        expect(plateauIsClean(plateau(image, fit(0.6, 46), layout))).toBe(false);
    });

    /**
     * Over smooth pictures that are not flat, out-of-focus backgrounds and
     * soft shading, the surface the plateau check fits cannot follow the
     * picture, so its bounds grow; a remnant there still shows. A 320 px
     * corner of a 1024 px picture, with the 48 px logo 96 px in (at 0.6 of
     * the capture) or 32 px in (at the capture's own), degraded as a whole.
     */
    const SMOOTH_COPIES: [string, (image: RgbaImage) => RgbaImage, number][] = [
        ["saved as JPEG at quality 85", image => jpegLike(image, 85), 1],
        ["saved as JPEG at quality 75", image => jpegLike(image, 75), 1],
        ["shrunk to 98 % with Lanczos", image => resized(image, 0.98, "lanczos"), 0.98],
        ["enlarged to 102 % with Lanczos", image => resized(image, 1.02, "lanczos"), 1.02],
    ];
    const SMOOTH_LOGOS = [["the 48 px logo 96 px in", 176, 0.6], ["the 48 px logo 32 px in", 240, 1]] as const;

    /** What removal left against the clean picture degraded the same way: mean over the logo's core and soft edge, and the largest difference near it. */
    function leftAgainst(cleaned: RgbaImage, copy: RgbaImage, cleanCopy: RgbaImage) {
        const lum = (image: RgbaImage, i: number) => (image.data[i * 4] + image.data[i * 4 + 1] + image.data[i * 4 + 2]) / 3;
        const n = copy.width * copy.height;
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, lum(copy, i) - lum(cleanCopy, i));
        let core = 0, coreCount = 0, edge = 0, edgeCount = 0, largest = 0;
        for (let i = 0; i < n; i++) {
            const logoAdds = lum(copy, i) - lum(cleanCopy, i), left = lum(cleaned, i) - lum(cleanCopy, i);
            if (logoAdds > 0.5 * peak) { core += left; coreCount++; } else if (logoAdds > 0.06 * peak) { edge += left; edgeCount++; }
            if (logoAdds > 0.06 * peak) largest = Math.max(largest, Math.abs(left));
        }
        return { core: core / coreCount, edge: edge / edgeCount, largest };
    }

    /** Out-of-focus light varies most from one picture to the next, so it is drawn four ways. */
    const smoothScenes = SMOOTH.flatMap(kind => (kind === "bokeh" ? [1, 2, 3, 4] : [3]).map(seed => [kind, seed] as const));

    it("never reports a removal that leaves a copy or an outline of the logo over smooth shading, out-of-focus light or clouds", () => {
        let found = 0;
        const claims: string[] = [];
        for (const [kind, seed] of smoothScenes) {
            for (const [logoLabel, at, gain] of SMOOTH_LOGOS) {
                const clean = smooth(kind, 320, 320, seed);
                const marked = applySparkle(clean, alphaFor("v1-48", 48), at, at, gain);
                for (const [label, degrade, factor] of SMOOTH_COPIES) {
                    const copy = degrade(marked), cleanCopy = degrade(clean);
                    const size = Math.round(1024 * factor);
                    const frame = { width: size, height: size, left: size - copy.width, top: size - copy.height };
                    const fit = findSparkle(copy, frame);
                    if (!fit) continue;
                    found++;
                    if (!fit.clean) continue;
                    const cleaned = clone(copy);
                    removeSparkle(cleaned, fit, frame);
                    const left = leftAgainst(cleaned, copy, cleanCopy);
                    // Over these pictures a remnant of 3 levels, or an outline of 6 in single pixels, is visible.
                    if (Math.abs(left.core) > 2 || Math.abs(left.edge) > 2 || left.largest > 6) {
                        claims.push(`${kind} ${seed}, ${logoLabel}, ${label}: removed as ${fit.size} px at opacity ${fit.gain.toFixed(2)}, leaving ${left.core.toFixed(1)} in the core, ${left.edge.toFixed(1)} at the edge, up to ${left.largest.toFixed(0)}`);
                    }
                }
            }
        }
        expect(found).toBeGreaterThan(24);
        expect(claims).toEqual([]);
    }, 180_000);

    it("still removes the logo from the file Gemini saved over the same smooth pictures, and never leaves a trace", () => {
        let removed = 0;
        for (const [kind, seed] of smoothScenes) {
            for (const [logoLabel, at, gain] of SMOOTH_LOGOS) {
                const label = `${kind} ${seed}, ${logoLabel}`;
                const clean = smooth(kind, 320, 320, seed);
                const marked = applySparkle(clean, alphaFor("v1-48", 48), at, at, gain);
                const frame = { width: 1024, height: 1024, left: 704, top: 704 };
                const fit = findSparkle(marked, frame);
                expect(fit, label).not.toBeNull();
                // Over out-of-focus light the surface the plateau check fits can stray from the picture by as much
                // as a remnant would, so a few are left unchanged rather than certified.
                if (!fit!.clean) continue;
                removed++;
                const cleaned = clone(marked);
                removeSparkle(cleaned, fit!, frame);
                const left = leftAgainst(cleaned, marked, clean);
                expect(Math.max(Math.abs(left.core), Math.abs(left.edge)), label).toBeLessThan(0.5);
                expect(left.largest, label).toBeLessThanOrEqual(2);
            }
        }
        expect(removed).toBeGreaterThanOrEqual(10);
    }, 60_000);

    it("judges fine detail and the core, direction by direction", () => {
        const clean = smooth("bokeh", 320, 320, 5);
        const marked = applySparkle(clean, alphaFor("v1-48", 48), 176, 176, 0.6);
        const drawn = (gain: number) => ({ map: alphaFor("v1-48", 48), x: 176, y: 176, gain });
        // The right logo at its own opacity leaves no fine detail beyond the picture's, and nothing in the core.
        expect(fineIsClean(fine(marked, drawn(0.6)))).toBe(true);
        const exact = depthResidue(marked, alphaFor("v1-48", 48), 0.6, 176, 176);
        expect(Math.max(...exact.map(Math.abs))).toBeLessThan(1.5);
        expect(depthIsClean(exact, true)).toBe(true);
        // Saved again as JPEG, the same removal leaves the JPEG's ringing around the logo as fine detail.
        expect(fineIsClean(fine(jpegLike(marked, 75), drawn(0.6)))).toBe(false);
        // Too faint a removal leaves the core brighter in every direction; too strong, darker, refused on a scaled logo.
        const faint = depthResidue(marked, alphaFor("v1-48", 48), 0.45, 176, 176);
        expect(Math.min(...faint)).toBeGreaterThan(3);
        expect(depthIsClean(faint, false)).toBe(false);
        const strong = depthResidue(marked, alphaFor("v1-48", 48), 0.75, 176, 176);
        expect(Math.max(...strong)).toBeLessThan(-2);
        expect(depthIsClean(strong, true)).toBe(false);
        expect(depthIsClean(strong, false)).toBe(true);
    });
});

describe("leaving pictures without the sparkle alone", () => {
    it("finds nothing on any clean background at any size", () => {
        for (const [width, height] of LAYOUTS) {
            for (const kind of BACKGROUNDS) {
                const { image, frame } = corner(width, height, kind, 11);
                expect(findSparkle(image, frame), `${kind} ${width} × ${height}`).toBeNull();
            }
        }
    }, 60_000);

    it("does not mistake a white shape, a veil or glare in the corner for the logo", () => {
        let checked = 0;
        for (const [width, height] of [[1024, 1024], [1376, 768], [1024, 768], [2752, 1536]] as const) {
            for (const p of sparklePlacements(width, height)) {
                const { box } = logo(p);
                for (const kind of ["flat-navy", "flat-grey", "gradient", "photo", "noise"] as const) {
                    const scene = corner(width, height, kind, 5);
                    const x = box.x - scene.frame.left, y = box.y - scene.frame.top;
                    const trials: [string, RgbaImage][] = [];
                    for (const shape of SHAPES) for (const white of [255, 220]) trials.push([`${shape} ${white}`, paintShape(scene.image, shape, x, y, box.width, white)]);
                    for (const opacity of [0.25, 0.45]) trials.push([`veil ${opacity}`, veil(scene.image, x, y, box.width, opacity)]);
                    trials.push(["glare", glare(scene.image, x, y, box.width)]);
                    for (const [label, image] of trials) {
                        checked++;
                        expect(findSparkle(image, scene.frame), `${label} on ${kind} at ${p.family} ${width} × ${height}`).toBeNull();
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    }, 300_000);

    it("leaves a see-through corner alone even if it holds the logo's pattern", () => {
        const scene = corner(1024, 1024, "flat-navy");
        const marked = paint(scene, logo(placement(1024, 1024, "corner-32")));
        for (let i = 3; i < marked.data.length; i += 4) marked.data[i] = 200;
        expect(findSparkle(marked, scene.frame)).toBeNull();
    });

    it("rejects every position of every logo across a busy synthetic picture scattered with white shapes and captions", () => {
        const width = 560, height = 420;
        let picture = background("photo", width, height, 21);
        const next = random(99);
        for (let k = 0; k < 40; k++) {
            const size = 16 + Math.floor(next() * 90);
            const x = Math.floor(next() * (width - size)), y = Math.floor(next() * (height - size));
            picture = next() < 0.2
                ? veil(picture, x, y, size, 0.15 + next() * 0.4)
                : paintShape(picture, SHAPES[Math.floor(next() * SHAPES.length)], x, y, size, 190 + Math.floor(next() * 66));
        }
        const maps: [string, AlphaMap, number][] = [
            ["v1-48@48", alphaFor("v1-48", 48), 1], ["v1-96@96", alphaFor("v1-96", 96), 1], ["v2-96@96", alphaFor("v2-96", 96), 1],
            ["v2-36@36", alphaFor("v2-36", 36), 1], ["v2-96@48", alphaFor("v2-96", 48), 1],
            ...[46, 48, 50].map(size => [`v1-48@${size} × 0.6`, alphaFor("v1-48", size), 0.6] as [string, AlphaMap, number]),
            ["v1-48 scaled to 41 px × 0.6", placedAlpha("v1-48", 0.12, 0.57, 1024 / 1200, 768 / 896).map, 0.6],
        ];
        let windows = 0;
        const accepted: string[] = [];
        for (const [label, map, gain] of maps) {
            for (let y = 3; y + map.height + 3 < height; y += 5) {
                for (let x = 3; x + map.width + 3 < width; x += 5) {
                    windows++;
                    if (passes(measure(picture, map, gain, x, y))) accepted.push(`${label} ${x},${y}`);
                }
            }
        }
        expect(windows).toBeGreaterThan(40_000);
        expect(accepted).toEqual([]);
    }, 120_000);
});
