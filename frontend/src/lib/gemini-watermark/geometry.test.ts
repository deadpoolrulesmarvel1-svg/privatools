import { describe, expect, it } from "vitest";
import { canonicalLongSide, isLargeImage, sparkleCandidates, sparkleRegion, type Candidate } from "./geometry";

const pick = (candidates: Candidate[], layout: Candidate["layout"]) => candidates.find(candidate => candidate.layout === layout);
const place = (candidate: Candidate | undefined) => candidate && { mask: candidate.mask, size: candidate.size, margin: candidate.margin, x: candidate.x, y: candidate.y, search: candidate.search };

describe("where Gemini puts the sparkle", () => {
    it("treats an image as large only when both sides exceed 1024 px", () => {
        expect(isLargeImage(1024, 1024)).toBe(false);
        expect(isLargeImage(1025, 1025)).toBe(true);
        expect(isLargeImage(1025, 1024)).toBe(false);
        expect(isLargeImage(1024, 2048)).toBe(false);
        expect(isLargeImage(2752, 1536)).toBe(true);
    });

    it("uses the 48 px logo 32 px in for the earlier layout at 1024 px and below", () => {
        expect(place(pick(sparkleCandidates(1024, 1024), "legacy"))).toEqual({ mask: "v1-48", size: 48, margin: 32, x: 944, y: 944, search: 0 });
        expect(place(pick(sparkleCandidates(832, 1248), "legacy"))).toEqual({ mask: "v1-48", size: 48, margin: 32, x: 752, y: 1168, search: 0 });
    });

    it("uses the 96 px logo 64 px in for the earlier layout above 1024 px", () => {
        expect(place(pick(sparkleCandidates(1025, 1025), "legacy"))).toEqual({ mask: "v1-96", size: 96, margin: 64, x: 865, y: 865, search: 0 });
        expect(place(pick(sparkleCandidates(2048, 2048), "legacy"))).toEqual({ mask: "v1-96", size: 96, margin: 64, x: 1888, y: 1888, search: 0 });
    });

    it("uses the May 2026 96 px logo 192 px in for large current-layout images", () => {
        expect(place(pick(sparkleCandidates(2752, 1536), "current"))).toEqual({ mask: "v2-96", size: 96, margin: 192, x: 2464, y: 1248, search: 0 });
        expect(place(pick(sparkleCandidates(2816, 1536), "current"))).toEqual({ mask: "v2-96", size: 96, margin: 192, x: 2528, y: 1248, search: 0 });
    });

    it("scales the current small logo's margin from the canonical source, so it moves with the aspect ratio", () => {
        // 1024-class sources, told apart by the short side (heights near 572, 559 and 540 px).
        expect(canonicalLongSide(1024, 572)).toBe(2752);
        expect(canonicalLongSide(1024, 559)).toBe(2816);
        expect(canonicalLongSide(1024, 540)).toBe(2848);
        expect(canonicalLongSide(1024, 1024)).toBe(2752);
        expect(place(pick(sparkleCandidates(1024, 572), "current"))).toEqual({ mask: "v2-36", size: 36, margin: 71, x: 917, y: 465, search: 3 });
        expect(place(pick(sparkleCandidates(1024, 559), "current"))).toEqual({ mask: "v2-36", size: 36, margin: 70, x: 918, y: 453, search: 3 });
        expect(place(pick(sparkleCandidates(1024, 540), "current"))).toEqual({ mask: "v2-36", size: 36, margin: 69, x: 919, y: 435, search: 3 });
        // Portrait is the same rule turned round.
        expect(place(pick(sparkleCandidates(572, 1024), "current"))).toEqual({ mask: "v2-36", size: 36, margin: 71, x: 465, y: 917, search: 3 });
        expect(place(pick(sparkleCandidates(1024, 1024), "current"))).toEqual({ mask: "v2-36", size: 36, margin: 71, x: 917, y: 917, search: 3 });
    });

    it("gives free-tier half-size images a proportionally larger current logo", () => {
        // Twice the long side lands on the canonical source: 1376 → 2752, 1408 → 2816, 1424 → 2848.
        expect(canonicalLongSide(1376, 768)).toBe(2752);
        expect(canonicalLongSide(1408, 768)).toBe(2816);
        expect(canonicalLongSide(1424, 800)).toBe(2848);
        // A tie between two sources keeps the first.
        expect(canonicalLongSide(1392, 768)).toBe(2752);
        expect(place(pick(sparkleCandidates(1376, 768), "current"))).toEqual({ mask: "v2-96", size: 48, margin: 96, x: 1232, y: 624, search: 3 });
        expect(place(pick(sparkleCandidates(768, 1408), "current"))).toEqual({ mask: "v2-96", size: 48, margin: 96, x: 624, y: 1264, search: 3 });
    });

    it("offers one earlier and one current position, and none that would fall outside the image", () => {
        expect(sparkleCandidates(1024, 1024).map(candidate => candidate.layout)).toEqual(["legacy", "current"]);
        expect(sparkleCandidates(2752, 1536).map(candidate => candidate.layout)).toEqual(["legacy", "current"]);
        // Too small for the 48 px logo and its 32 px margin; the current layout's scaled margin still fits.
        expect(sparkleCandidates(60, 60).map(candidate => candidate.layout)).toEqual(["current"]);
        expect(sparkleCandidates(20, 20)).toEqual([]);
        expect(sparkleRegion(20, 20)).toBeNull();
    });

    it("bounds the corner that has to be read, with room for the search and the outline check", () => {
        const region = sparkleRegion(2752, 1536)!;
        for (const candidate of sparkleCandidates(2752, 1536)) {
            expect(candidate.x - candidate.search - 3).toBeGreaterThanOrEqual(region.left);
            expect(candidate.y - candidate.search - 3).toBeGreaterThanOrEqual(region.top);
            expect(candidate.x + candidate.size + candidate.search + 3).toBeLessThanOrEqual(region.left + region.width);
            expect(candidate.y + candidate.size + candidate.search + 3).toBeLessThanOrEqual(region.top + region.height);
        }
        expect(region.width * region.height).toBeLessThan(2752 * 1536 / 20);
    });
});
