/**
 * Uniform random integers for the password generator.
 *
 * The property under test is the absence of modulo bias. `getRandomValues()[0]
 * % n` is skewed because 2^32 is not a multiple of n — the first `2^32 % n`
 * outcomes get one extra draw. At a 32-bit source and an ~86-character set the
 * skew is about one part in 50 million, so this is hygiene rather than a break,
 * but the UI advertises crypto-grade generation and should mean it.
 *
 * Bias is not tested statistically — that would be flaky. The rejection branch
 * is driven directly with a stubbed source instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { randomInt } from "./randomInt";

const RANGE = 2 ** 32;

/** Feed randomInt an exact sequence of 32-bit draws. */
function stubDraws(...draws: number[]) {
    let i = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((arr: ArrayBufferView) => {
        (arr as Uint32Array)[0] = draws[Math.min(i++, draws.length - 1)];
        return arr;
    });
}

afterEach(() => vi.restoreAllMocks());

describe("randomInt", () => {
    it("stays within [0, n)", () => {
        for (let i = 0; i < 2000; i++) {
            const v = randomInt(86);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(86);
        }
    });

    it("returns 0 for n = 1 without consuming randomness", () => {
        const spy = vi.spyOn(crypto, "getRandomValues");
        expect(randomInt(1)).toBe(0);
        expect(spy).not.toHaveBeenCalled();
    });

    it("can reach every value in the range", () => {
        const seen = new Set<number>();
        for (let i = 0; i < 4000; i++) seen.add(randomInt(6));
        expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("rejects a draw from the ragged tail and retries", () => {
        // 3 * 1431655765 === 2^32 - 1, so 4294967295 is the single biased
        // outcome for n = 3 and must be discarded rather than folded in.
        const limit = RANGE - (RANGE % 3);
        expect(limit).toBe(4294967295);
        stubDraws(4294967295, 7);
        expect(randomInt(3)).toBe(7 % 3);
        expect(crypto.getRandomValues).toHaveBeenCalledTimes(2);
    });

    it("accepts the largest unbiased draw", () => {
        stubDraws(4294967294);
        expect(randomInt(3)).toBe(4294967294 % 3);
        expect(crypto.getRandomValues).toHaveBeenCalledTimes(1);
    });

    it("never folds the tail in — the classic modulo bug", () => {
        // A biased implementation would return 4294967295 % 3 === 0 here.
        stubDraws(4294967295, 4294967295, 4294967295, 5);
        expect(randomInt(3)).toBe(5 % 3);
    });

    it("rejects a non-positive or non-integer n", () => {
        for (const bad of [0, -1, 2.5, NaN]) {
            expect(() => randomInt(bad)).toThrow(RangeError);
        }
    });
});
