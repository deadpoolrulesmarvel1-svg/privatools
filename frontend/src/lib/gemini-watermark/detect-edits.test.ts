/**
 * Copies edited after Gemini saved them, over smooth pictures where any
 * remnant shows: sharpened with an unsharp mask, as gallery "enhance"
 * buttons and photo editors do, and resized with a bicubic filter, the
 * default of many apps. Both change the logo's edge without changing its
 * core, so an opacity fitted at the edge comes out wrong and leaves a copy
 * of the logo, dark or light, in the core. The engine must never report
 * such a removal: either the copy is cleaned or it is left unchanged.
 */
import { describe, expect, it } from "vitest";
import { alphaFor } from "./alpha";
import { findSparkle, removeSparkle, type RgbaImage } from "./detect";
import { applySparkle, background, clone, jpegLike, resized, smooth, unsharp, type Background, type Smooth } from "@/test/gemini-fixtures";

type Edit = [string, (image: RgbaImage) => RgbaImage, number];

const SHARPENED: Edit[] = [
    ["unsharp mask, radius 1 at 40 %", image => unsharp(image, 1, 0.4), 1],
    ["unsharp mask, radius 1 at 60 %", image => unsharp(image, 1, 0.6), 1],
    ["unsharp mask, radius 1.5 at 50 %", image => unsharp(image, 1.5, 0.5), 1],
    ["unsharp mask, radius 2 at 100 %", image => unsharp(image, 2, 1), 1],
];
/**
 * Sharpened and then saved as JPEG, as a gallery's "enhance" followed by its
 * export does: the JPEG softens the sharpened edge back and smooths the grain,
 * so the fit lands within the layout's range and each direction of the core
 * reads noisily, while the core as a whole is still a dark copy of the logo.
 */
const SHARPENED_THEN_JPEG: Edit[] = [
    ["unsharp mask, radius 1 at 40 %, then JPEG at quality 90", image => jpegLike(unsharp(image, 1, 0.4), 90), 1],
    ["unsharp mask, radius 1.5 at 40 %, then JPEG at quality 85", image => jpegLike(unsharp(image, 1.5, 0.4), 85), 1],
    ["unsharp mask, radius 0.5 at 100 %, then JPEG at quality 85", image => jpegLike(unsharp(image, 0.5, 1), 85), 1],
    ["unsharp mask, radius 2 at 50 %, then JPEG at quality 90", image => jpegLike(unsharp(image, 2, 0.5), 90), 1],
];
const RESIZED: Edit[] = [
    ["shrunk to 95 % with a bicubic filter", image => resized(image, 0.95, "bicubic"), 0.95],
    ["shrunk to 97 % with a bicubic filter", image => resized(image, 0.97, "bicubic"), 0.97],
    ["shrunk to 98 % with a bicubic filter", image => resized(image, 0.98, "bicubic"), 0.98],
    ["enlarged to 102 % with a bicubic filter", image => resized(image, 1.02, "bicubic"), 1.02],
    ["enlarged to 103 % with a bicubic filter", image => resized(image, 1.03, "bicubic"), 1.03],
    ["enlarged to 105 % with a bicubic filter", image => resized(image, 1.05, "bicubic"), 1.05],
];
/** The 48 px logo 96 px in at 0.6 of the capture, and 32 px in at the capture's own, on a 320 px corner of a 1024 px picture. */
const LOGOS = [["the 48 px logo 96 px in", 176, 0.6], ["the 48 px logo 32 px in", 240, 1]] as const;
type Scene = [Smooth | Background, number];
const SMOOTH_SCENES: Scene[] = [["shading", 3], ["bokeh", 1], ["bokeh", 2], ["clouds", 3], ["bands", 1], ["bands", 2]];
/**
 * Texture hides a remnant from the eye only up to its own size: a sharpened
 * logo over per-pixel grain of 12 levels fits at 1.15 times its opacity
 * and leaves a dark star 8 to 19 levels deep, plain at 100 %.
 */
const TEXTURED_SCENES: Scene[] = [1, 2, 3, 4, 5, 6].map(seed => ["noise", seed] as Scene);
const SMOOTH_KINDS: readonly string[] = ["shading", "bokeh", "clouds", "bands"];

function scene(kind: Smooth | Background, seed: number): RgbaImage {
    return SMOOTH_KINDS.includes(kind) ? smooth(kind as Smooth, 320, 320, seed) : background(kind as Background, 320, 320, seed);
}

/** What removal left against the clean picture edited the same way: the mean over the logo's core and soft edge, and the largest difference near it. */
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

function claims(edits: Edit[], scenes: Scene[]) {
    let found = 0;
    const found_claims: string[] = [];
    for (const [kind, seed] of scenes) {
        for (const [logoLabel, at, gain] of LOGOS) {
            const clean = scene(kind, seed);
            const marked = applySparkle(clean, alphaFor("v1-48", 48), at, at, gain);
            for (const [label, edit, factor] of edits) {
                const copy = edit(marked), cleanCopy = edit(clean);
                const size = Math.round(1024 * factor);
                const frame = { width: size, height: size, left: size - copy.width, top: size - copy.height };
                const fit = findSparkle(copy, frame);
                if (!fit) continue;
                found++;
                if (!fit.clean) continue;
                const cleaned = clone(copy);
                removeSparkle(cleaned, fit, frame);
                const left = leftAgainst(cleaned, copy, cleanCopy);
                // A copy of the logo 4 levels deep over these pictures, or a line of 10 in single pixels, shows.
                if (Math.abs(left.core) > 4 || Math.abs(left.edge) > 4 || left.largest > 10) {
                    found_claims.push(`${kind} ${seed}, ${logoLabel}, ${label}: removed as ${fit.size} px at opacity ${fit.gain.toFixed(2)}, leaving ${left.core.toFixed(1)} in the core, ${left.edge.toFixed(1)} at the edge, up to ${left.largest.toFixed(0)}`);
                }
            }
        }
    }
    return { found, claims: found_claims };
}

describe("copies sharpened or resized with a bicubic filter after Gemini made them", () => {
    it("never reports a removal that leaves a dark or light copy of the logo after an unsharp mask over smooth pictures", () => {
        const { found, claims: list } = claims(SHARPENED, SMOOTH_SCENES);
        expect(found).toBeGreaterThan(24);
        expect(list).toEqual([]);
    }, 300_000);

    it("never reports a removal that leaves a dark copy of the logo after an unsharp mask over per-pixel grain", () => {
        const { found, claims: list } = claims(SHARPENED, TEXTURED_SCENES);
        expect(found).toBeGreaterThan(24);
        expect(list).toEqual([]);
    }, 300_000);

    it("never reports a removal that leaves a dark copy of the logo after an unsharp mask and a JPEG save over per-pixel grain", () => {
        const { found, claims: list } = claims(SHARPENED_THEN_JPEG, TEXTURED_SCENES);
        expect(found).toBeGreaterThan(24);
        expect(list).toEqual([]);
    }, 300_000);

    it("never reports a removal that leaves a copy or an outline of the logo after a bicubic resize", () => {
        const { found, claims: list } = claims(RESIZED, SMOOTH_SCENES);
        expect(found).toBeGreaterThan(20);
        expect(list).toEqual([]);
    }, 300_000);
});
