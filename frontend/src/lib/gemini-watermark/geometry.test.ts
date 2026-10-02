import { describe, expect, it } from "vitest";
import { MASK_SOURCES } from "./masks";
import { canonicalLongSide, INSET_GAIN, isLargeImage, placementBox, REGION_PAD, sparklePlacements, sparkleRegion, type Family, type Placement } from "./geometry";

const pick = (width: number, height: number, family: Family) => sparklePlacements(width, height).filter(p => p.family === family);
/** A native placement's size, position and search, as one record. */
const place = (p: Placement | undefined) => p && {
    mask: p.mask, gain: p.gain, size: Math.round(MASK_SOURCES[p.mask].size * p.scaleX), x: p.left, y: p.top, search: p.search, sizeSearch: p.sizeSearch,
};

describe("where Gemini puts the sparkle", () => {
    it("treats an image as large only when both sides exceed 1024 px", () => {
        expect(isLargeImage(1024, 1024)).toBe(false);
        expect(isLargeImage(1025, 1025)).toBe(true);
        expect(isLargeImage(1025, 1024)).toBe(false);
        expect(isLargeImage(1024, 2048)).toBe(false);
        expect(isLargeImage(2752, 1536)).toBe(true);
    });

    it("looks for the 48 px logo 32 px from the corner, at the capture's opacity, at 1024 px and below", () => {
        expect(place(pick(1024, 1024, "corner-32")[0])).toEqual({ mask: "v1-48", gain: 1, size: 48, x: 944, y: 944, search: 0, sizeSearch: 0 });
        expect(place(pick(1408, 768, "corner-32")[0])).toEqual({ mask: "v1-48", gain: 1, size: 48, x: 1328, y: 688, search: 0, sizeSearch: 0 });
        expect(place(pick(832, 1248, "corner-32")[0])).toEqual({ mask: "v1-48", gain: 1, size: 48, x: 752, y: 1168, search: 0, sizeSearch: 0 });
    });

    it("looks for the 96 px logo 64 px in, and the paler one 192 px in, when both sides are over 1024 px", () => {
        expect(place(pick(1025, 1025, "corner-64")[0])).toEqual({ mask: "v1-96", gain: 1, size: 96, x: 865, y: 865, search: 0, sizeSearch: 0 });
        expect(place(pick(2752, 1536, "corner-192")[0])).toEqual({ mask: "v2-96", gain: 1, size: 96, x: 2464, y: 1248, search: 0, sizeSearch: 0 });
        expect(place(pick(2816, 1536, "corner-192")[0])).toEqual({ mask: "v2-96", gain: 1, size: 96, x: 2528, y: 1248, search: 0, sizeSearch: 0 });
        expect(pick(2752, 1536, "corner-32")).toEqual([]);
    });

    it("looks for the fainter 48 px logo 96 px in on Gemini's 1K and 0.5K sizes, searching its size and position", () => {
        for (const [width, height] of [[1024, 1024], [848, 1264], [1264, 848], [1376, 768], [768, 1376], [1584, 672], [512, 512], [2048, 2048], [2400, 1792]]) {
            const [inset] = pick(width, height, "inset-96");
            expect(place(inset), `${width} × ${height}`).toEqual({
                mask: "v1-48", gain: INSET_GAIN, size: 48, x: width - 144, y: height - 144, search: 2, sizeSearch: 2,
            });
        }
        expect(INSET_GAIN).toBe(0.6);
    });

    it("does not look for it on standard sizes whose catalogue entry has no such logo", () => {
        for (const [width, height] of [[832, 1248], [2752, 1536], [2816, 1536], [4096, 4096], [5504, 3072]]) {
            expect(pick(width, height, "inset-96"), `${width} × ${height}`).toEqual([]);
        }
    });

    it("looks for it on sizes Gemini does not make, and where it would sit if the picture was scaled from a 1K size", () => {
        // 720 × 1456 matches no 1K proportions closely: only the plain 48 px logo 96 px in.
        expect(pick(720, 1456, "inset-96").map(place)).toEqual([{ mask: "v1-48", gain: 0.6, size: 48, x: 576, y: 1312, search: 2, sizeSearch: 2 }]);
        // 1024 × 768 is 1200 × 896 scaled down: its logo is about 41 px, 82 px in, at a fraction of a pixel.
        const [native, projected] = pick(1024, 768, "inset-96");
        expect(place(native)).toEqual({ mask: "v1-48", gain: 0.6, size: 48, x: 880, y: 624, search: 2, sizeSearch: 2 });
        expect(projected).toMatchObject({ mask: "v1-48", gain: 0.6, subpixel: true, search: 0, sizeSearch: 0 });
        expect(projected.scaleX).toBeCloseTo(1024 / 1200, 6);
        expect(projected.scaleY).toBeCloseTo(768 / 896, 6);
        expect(projected.left).toBeCloseTo((1200 - 144) * 1024 / 1200, 6);
        expect(projected.top).toBeCloseTo((896 - 144) * 768 / 896, 6);
        expect(placementBox(projected, 1024, 768)).toEqual({ size: 41, marginRight: 82, marginBottom: 82 });
        // A picture whose proportions match no 1K size is not projected.
        expect(pick(1000, 300, "inset-96").filter(p => p.subpixel)).toEqual([]);
    });

    it("scales the small current logo's margin from the canonical source, so it moves with the aspect ratio", () => {
        // 1024-class sources, told apart by the short side (heights near 572, 559 and 540 px).
        expect(canonicalLongSide(1024, 572)).toBe(2752);
        expect(canonicalLongSide(1024, 559)).toBe(2816);
        expect(canonicalLongSide(1024, 540)).toBe(2848);
        expect(canonicalLongSide(1024, 1024)).toBe(2752);
        expect(place(pick(1024, 572, "proportional")[0])).toEqual({ mask: "v2-36", gain: 1, size: 36, x: 917, y: 465, search: 3, sizeSearch: 0 });
        expect(place(pick(1024, 559, "proportional")[0])).toEqual({ mask: "v2-36", gain: 1, size: 36, x: 918, y: 453, search: 3, sizeSearch: 0 });
        expect(place(pick(1024, 540, "proportional")[0])).toEqual({ mask: "v2-36", gain: 1, size: 36, x: 919, y: 435, search: 3, sizeSearch: 0 });
        // Portrait is the same rule turned round.
        expect(place(pick(572, 1024, "proportional")[0])).toEqual({ mask: "v2-36", gain: 1, size: 36, x: 465, y: 917, search: 3, sizeSearch: 0 });
    });

    it("gives half-size images a proportionally larger small logo", () => {
        // Twice the long side lands on the canonical source: 1376 → 2752, 1408 → 2816, 1424 → 2848.
        expect(canonicalLongSide(1376, 768)).toBe(2752);
        expect(canonicalLongSide(1408, 768)).toBe(2816);
        expect(canonicalLongSide(1424, 800)).toBe(2848);
        // A tie between two sources keeps the first.
        expect(canonicalLongSide(1392, 768)).toBe(2752);
        expect(place(pick(1376, 768, "proportional")[0])).toEqual({ mask: "v2-96", gain: 1, size: 48, x: 1232, y: 624, search: 3, sizeSearch: 0 });
        expect(place(pick(768, 1408, "proportional")[0])).toEqual({ mask: "v2-96", gain: 1, size: 48, x: 624, y: 1264, search: 3, sizeSearch: 0 });
    });

    it("offers no placement that would fall outside the image", () => {
        expect(sparklePlacements(1024, 1024).map(p => p.family)).toEqual(["corner-32", "proportional", "inset-96"]);
        expect(sparklePlacements(2752, 1536).map(p => p.family)).toEqual(["corner-64", "corner-192"]);
        // Too small for the 48 px logo and its margins; the small logo's scaled margin still fits.
        expect(sparklePlacements(60, 60).map(p => p.family)).toEqual(["proportional"]);
        expect(sparklePlacements(20, 20)).toEqual([]);
        expect(sparkleRegion(20, 20)).toBeNull();
    });

    it("bounds the corner that has to be read, with room for the searches and the residue check", () => {
        for (const [width, height] of [[1024, 1024], [1024, 768], [2752, 1536], [720, 1456], [1376, 768]]) {
            const region = sparkleRegion(width, height)!;
            for (const p of sparklePlacements(width, height)) {
                const size = MASK_SOURCES[p.mask].size;
                const reach = p.search + p.sizeSearch + REGION_PAD;
                expect(Math.max(0, Math.floor(p.left) - reach), `${width} × ${height} ${p.family}`).toBeGreaterThanOrEqual(region.left);
                expect(Math.max(0, Math.floor(p.top) - reach)).toBeGreaterThanOrEqual(region.top);
                expect(Math.min(width, Math.ceil(p.left + size * p.scaleX) + reach)).toBeLessThanOrEqual(region.left + region.width);
                expect(Math.min(height, Math.ceil(p.top + size * p.scaleY) + reach)).toBeLessThanOrEqual(region.top + region.height);
            }
            expect(region.width * region.height).toBeLessThan(width * height / 10);
        }
    });
});
