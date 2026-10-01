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
import { alphaFor, placedAlpha, type AlphaMap } from "./alpha";
import { findSparkle, measure, passes, removeSparkle, type Fit, type Frame, type RgbaImage } from "./detect";
import { sparklePlacements, sparkleRegion, type Family, type Placement } from "./geometry";
import { MASK_SOURCES, type MaskId } from "./masks";
import { BACKGROUNDS, SHAPES, applySparkle, background, clone, glare, paintShape, random, veil, type Background } from "@/test/gemini-fixtures";

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

/** The logo a placement describes, moved by (dx, dy), at `size` px for a native one, at `gain` times the layout's opacity. */
function logo(p: Placement, { dx = 0, dy = 0, size, gain = 1, mask = p.mask }: { dx?: number; dy?: number; size?: number; gain?: number; mask?: MaskId } = {}): Logo {
    if (p.subpixel) {
        const placed = placedAlpha(mask, p.left + dx, p.top + dy, p.scaleX, p.scaleY);
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
                expect(fit!.clean, `${kind} clean`).toBe(true);
                expect(fit!.family, kind).toBe(family);
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
        for (const gain of [0.85, 1.15]) {
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

    it("finds the scaled logo a fraction of a pixel from its projected position", () => {
        const p = placement(1024, 768, "inset-96", 1);
        for (const [dx, dy] of [[-0.5, 0.25], [0.75, -0.5], [0.25, 1]]) {
            const scene = corner(1024, 768, "gradient", 3);
            const target = logo(p, { dx, dy });
            const marked = paint(scene, target);
            const fit = findSparkle(marked, scene.frame)!;
            expect({ family: fit.family, clean: fit.clean }, `${dx}, ${dy}`).toEqual({ family: "inset-96", clean: true });
            expect(Math.abs(fit.size - 41), `${dx}, ${dy} size`).toBeLessThanOrEqual(1);
            expect(Math.abs(fit.marginRight - (1024 - (p.left + dx) - 48 * p.scaleX)), `${dx}, ${dy} margin`).toBeLessThanOrEqual(1);
            expectClose("gradient", removeAndCompare(scene, marked, fit, target.box), `${dx}, ${dy}`);
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
