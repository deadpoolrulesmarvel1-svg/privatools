import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MASK_SOURCES, type MaskId } from "./masks";
import { alphaFor, baseAlpha, captureValues, placedAlpha } from "./alpha";

/**
 * The approved files, by SHA-256: the three GargantuaX PNGs as recorded when
 * they were downloaded, and bg_b_36_png as extracted byte for byte from
 * allenk's assets/embedded_assets.hpp (whose bg_48_png and bg_96_png are the
 * same files as GargantuaX's bg_48.png and bg_96.png).
 */
const APPROVED: Record<MaskId, string> = {
    "v1-48": "4afc99afe0ef108d67acc45bf4dc5da867ddb793bebc89c9243bb121ce7f0f57",
    "v1-96": "3e26f2233a12a5829acac174d8df1f3db40e07fef04ecdd0e035732154077911",
    "v2-96": "e5e95a3cd28454a1281465519c1b6209c22320856e2bc3074d2386d75cd8bff1",
    "v2-36": "a3e7d5ca932e6acf9ff826a4db47d597458480e72089da81a40bd4b52668cd31",
};

const peak = (values: Float32Array) => values.reduce((max, value) => Math.max(max, value), 0);

describe("Gemini logo masks", () => {
    it("embeds exactly the approved capture files", () => {
        expect(Object.keys(MASK_SOURCES).sort()).toEqual(Object.keys(APPROVED).sort());
        for (const [id, source] of Object.entries(MASK_SOURCES) as [MaskId, typeof MASK_SOURCES[MaskId]][]) {
            const digest = createHash("sha256").update(Buffer.from(source.png, "base64")).digest("hex");
            expect(digest, id).toBe(APPROVED[id]);
            expect(source.sha256, id).toBe(APPROVED[id]);
        }
    });

    it("decodes each capture at its stated size", () => {
        for (const id of Object.keys(MASK_SOURCES) as MaskId[]) {
            const { size, values } = captureValues(id);
            expect(size).toBe(MASK_SOURCES[id].size);
            expect(values).toHaveLength(size * size);
        }
    });

    it("reads opacity as brightness over black: about half for the 48 and 96 px captures, about a third for the paler ones", () => {
        expect(peak(baseAlpha("v1-48").values)).toBeCloseTo(129 / 255, 5);
        expect(peak(baseAlpha("v1-96").values)).toBeCloseTo(131 / 255, 5);
        expect(peak(baseAlpha("v2-96").values)).toBeCloseTo(93 / 255, 5);
        expect(peak(baseAlpha("v2-36").values)).toBeCloseTo(84 / 255, 5);
    });

    it("keeps only the logo's footprint, dropping the capture's background speckle", () => {
        for (const id of Object.keys(MASK_SOURCES) as MaskId[]) {
            const { size, values: raw } = captureValues(id);
            const { values } = baseAlpha(id);
            // Every capture has faint speckle over its black background; none of it counts as logo.
            const speckle = Array.from(raw).filter((value, i) => value > 0 && values[i] === 0).length;
            expect(speckle, `${id} speckle`).toBeGreaterThan(0);
            expect(Math.max(...Array.from(raw).filter((_, i) => values[i] === 0)), `${id} largest dropped value`).toBeLessThanOrEqual(6);
            for (const corner of [0, size - 1, size * (size - 1), size * size - 1]) expect(values[corner], `${id} corner`).toBe(0);
            // Inside the footprint, alpha is the capture value over 255, unchanged.
            const centre = (size >> 1) * size + (size >> 1);
            expect(values[centre]).toBeCloseTo(raw[centre] / 255, 6);
            expect(values.filter(value => value > 0).length).toBeLessThan(size * size);
        }
    });

    it("scales the large logo for smaller layouts without changing its strength much", () => {
        const scaled = alphaFor("v2-96", 48);
        expect([scaled.width, scaled.height]).toEqual([48, 48]);
        expect(scaled.values).toHaveLength(48 * 48);
        expect(Math.abs(peak(scaled.values) - peak(baseAlpha("v2-96").values))).toBeLessThan(0.05);
        expect(alphaFor("v2-96", 48)).toBe(scaled);
        expect(alphaFor("v2-96", 96)).toBe(baseAlpha("v2-96"));
    });

    it("draws the 48 px capture at a fraction of a pixel and a scale, keeping its total opacity", () => {
        const total = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0);
        const base = baseAlpha("v1-48");
        // At a whole-pixel position and scale 1 it is the capture itself.
        const same = placedAlpha("v1-48", 10, 20, 1, 1);
        expect([same.x, same.y, same.map.width, same.map.height]).toEqual([10, 20, 48, 48]);
        for (let i = 0; i < base.values.length; i++) expect(same.map.values[i]).toBeCloseTo(base.values[i], 6);
        // Scaled to 1024 / 1200 and shifted by a fraction, the box grows to hold it and the area-weighted opacity scales with it.
        const placed = placedAlpha("v1-48", 901.12, 644.57, 1024 / 1200, 768 / 896);
        expect([placed.x, placed.y]).toEqual([901, 644]);
        expect([placed.map.width, placed.map.height]).toEqual([42, 42]);
        expect(total(placed.map.values)).toBeCloseTo(total(base.values) * (1024 / 1200) * (768 / 896), 3);
        expect(peak(placed.map.values)).toBeLessThanOrEqual(peak(base.values) + 1e-6);
    });
});
