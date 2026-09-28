/**
 * Detection and removal on neutral synthetic pictures.
 *
 * Tolerance: under the logo, every channel of every pixel comes back within
 * 1 level (of 255) of the original. That is the rounding the blend itself
 * introduces: Gemini rounds alpha · 255 + (1 − alpha) · original to 8 bits,
 * and dividing that rounding error by (1 − alpha), at most about 1 / 0.49,
 * cannot move the result more than one level. Outside the logo's footprint
 * nothing changes at all.
 */
import { describe, expect, it } from "vitest";
import { alphaFor } from "./alpha";
import { detectSparkle, measure, passes, removeSparkle, type Frame, type RgbaImage } from "./detect";
import { sparkleCandidates, sparkleRegion, type Candidate } from "./geometry";
import type { MaskId } from "./masks";
import { BACKGROUNDS, SHAPES, applySparkle, background, clone, paintShape, random, veil, type Background } from "@/test/gemini-fixtures";

interface Scene { image: RgbaImage; frame: Frame }

/** The corner of a width × height picture that detection reads, filled with a synthetic background. */
function corner(width: number, height: number, kind: Background, seed = 1): Scene {
    const region = sparkleRegion(width, height)!;
    return { image: background(kind, region.width, region.height, seed), frame: { width, height, left: region.left, top: region.top } };
}

function candidate(width: number, height: number, layout: Candidate["layout"]): Candidate {
    const found = sparkleCandidates(width, height).find(c => c.layout === layout);
    if (!found) throw new Error(`no ${layout} position on ${width} × ${height}`);
    return found;
}

/** Largest channel difference inside the box, and whether anything outside it changed. */
function compare(before: RgbaImage, after: RgbaImage, box: { x: number; y: number; size: number }) {
    let inside = 0, outside = 0;
    for (let y = 0; y < before.height; y++) {
        for (let x = 0; x < before.width; x++) {
            const i = (y * before.width + x) * 4;
            let diff = 0;
            for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(before.data[i + c] - after.data[i + c]));
            const inBox = x >= box.x && x < box.x + box.size && y >= box.y && y < box.y + box.size;
            if (inBox) inside = Math.max(inside, diff); else outside = Math.max(outside, diff);
        }
    }
    return { inside, outside };
}

// Both sides of the 1024 px threshold, the current layout's canonical aspect ratios,
// a free-tier half-size image, and Gemini's large 16:9 output.
const LAYOUTS: [number, number, Candidate["layout"]][] = [
    [1024, 1024, "legacy"], [1024, 1024, "current"],
    [1025, 1025, "legacy"], [1025, 1025, "current"],
    [848, 1264, "legacy"], [1264, 848, "current"],
    [1024, 572, "current"], [1024, 559, "current"], [1024, 540, "current"], [572, 1024, "current"],
    [1376, 768, "current"], [768, 1376, "legacy"],
    [2752, 1536, "legacy"], [2752, 1536, "current"],
];

describe("removing the Gemini sparkle", () => {
    for (const [width, height, layout] of LAYOUTS) {
        it(`finds and removes the ${layout} logo on a ${width} × ${height} image over every background`, () => {
            const expected = candidate(width, height, layout);
            const alpha = alphaFor(expected.mask, expected.size);
            for (const kind of BACKGROUNDS) {
                const { image: original, frame } = corner(width, height, kind, width + height);
                const local = { x: expected.x - frame.left, y: expected.y - frame.top, size: expected.size };
                const marked = applySparkle(original, alpha, local.x, local.y);
                const detection = detectSparkle(marked, frame);
                expect(detection, `${kind}`).not.toBeNull();
                expect(detection!.candidate, kind).toMatchObject({ layout, size: expected.size, x: expected.x, y: expected.y });
                const cleaned = clone(marked);
                removeSparkle(cleaned, detection!, frame);
                const { inside, outside } = compare(original, cleaned, local);
                expect(inside, `${kind}: largest error under the logo`).toBeLessThanOrEqual(1);
                expect(outside, `${kind}: change outside the logo`).toBe(0);
            }
        });
    }

    it("finds the current small logo a few pixels from its formula position, where rounding put it", () => {
        const [width, height] = [1024, 559];
        const expected = candidate(width, height, "current");
        const alpha = alphaFor(expected.mask, expected.size);
        for (const [dx, dy] of [[2, -1], [-3, 3], [0, 2]]) {
            const { image: original, frame } = corner(width, height, "photo", 7);
            const x = expected.x + dx - frame.left, y = expected.y + dy - frame.top;
            const marked = applySparkle(original, alpha, x, y);
            const detection = detectSparkle(marked, frame)!;
            expect(detection.candidate).toMatchObject({ x: expected.x + dx, y: expected.y + dy });
            removeSparkle(marked, detection, frame);
            expect(compare(original, marked, { x, y, size: expected.size }).inside).toBeLessThanOrEqual(1);
        }
    });

    it("works on a whole picture as well as on its corner", () => {
        const original = background("photo", 1024, 1024, 3);
        const expected = candidate(1024, 1024, "legacy");
        const marked = applySparkle(original, alphaFor(expected.mask, expected.size), expected.x, expected.y);
        const detection = detectSparkle(marked)!;
        expect(detection.candidate).toMatchObject({ layout: "legacy", x: 944, y: 944 });
        removeSparkle(marked, detection);
        expect(compare(original, marked, expected)).toEqual({ inside: expect.any(Number), outside: 0 });
        expect(compare(original, marked, expected).inside).toBeLessThanOrEqual(1);
    });

    it("reads pixels without changing them while it looks", () => {
        const { image, frame } = corner(1024, 1024, "gradient");
        const expected = candidate(1024, 1024, "legacy");
        const marked = applySparkle(image, alphaFor(expected.mask, expected.size), expected.x - frame.left, expected.y - frame.top);
        const copy = clone(marked);
        detectSparkle(marked, frame);
        expect(marked.data).toEqual(copy.data);
    });
});

describe("leaving pictures without the sparkle alone", () => {
    it("finds nothing on any clean background at any size", () => {
        for (const [width, height] of LAYOUTS) {
            for (const kind of BACKGROUNDS) {
                const { image, frame } = corner(width, height, kind, 11);
                expect(detectSparkle(image, frame), `${kind} ${width} × ${height}`).toBeNull();
            }
        }
    });

    it("does not mistake a white shape in the corner for the logo", () => {
        let checked = 0;
        for (const [width, height] of [[1024, 1024], [1025, 1025], [1376, 768], [1024, 559]] as const) {
            for (const target of sparkleCandidates(width, height)) {
                for (const kind of BACKGROUNDS) {
                    const { image, frame } = corner(width, height, kind, 5);
                    const x = target.x - frame.left, y = target.y - frame.top;
                    for (const shape of SHAPES) {
                        for (const white of [255, 240, 200]) {
                            checked++;
                            expect(detectSparkle(paintShape(image, shape, x, y, target.size, white), frame), `${shape} ${white} on ${kind}`).toBeNull();
                        }
                    }
                    for (const opacity of [0.2, 0.35, 0.5]) {
                        checked++;
                        expect(detectSparkle(veil(image, x, y, target.size, opacity), frame), `veil ${opacity} on ${kind}`).toBeNull();
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    }, 120_000);

    it("leaves a see-through corner alone even if it holds the logo's pattern", () => {
        const { image, frame } = corner(1024, 1024, "flat-navy");
        const expected = candidate(1024, 1024, "legacy");
        const marked = applySparkle(image, alphaFor(expected.mask, expected.size), expected.x - frame.left, expected.y - frame.top);
        for (let i = 3; i < marked.data.length; i += 4) marked.data[i] = 200;
        expect(detectSparkle(marked, frame)).toBeNull();
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
        const masks: [MaskId, number][] = [["v1-48", 48], ["v1-96", 96], ["v2-96", 96], ["v2-36", 36], ["v2-96", 48]];
        let windows = 0;
        const accepted: string[] = [];
        for (const [id, size] of masks) {
            const alpha = alphaFor(id, size);
            for (let y = 3; y + size + 3 < height; y += 5) {
                for (let x = 3; x + size + 3 < width; x += 5) {
                    windows++;
                    if (passes(measure(picture, alpha, x, y))) accepted.push(`${id}@${size} ${x},${y}`);
                }
            }
        }
        expect(windows).toBeGreaterThan(20_000);
        expect(accepted).toEqual([]);
    }, 60_000);
});
