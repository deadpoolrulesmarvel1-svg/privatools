/**
 * Uniform random integer in [0, n), free of modulo bias.
 *
 * The obvious `crypto.getRandomValues(new Uint32Array(1))[0] % n` is not
 * uniform: 2^32 is not a multiple of most n, so the first `2^32 % n` outcomes
 * receive one extra draw. With a 32-bit source and a password alphabet under
 * ~100 characters the skew is roughly one part in 50 million — far too small to
 * weaken a generated password — but the generator tells users it is
 * crypto-grade, and a random source with a thumb on the scale should not ship
 * behind that claim.
 *
 * Rejection sampling removes it: discard any draw landing in the ragged tail
 * above the largest exact multiple of n, then retry. Each retry has probability
 * `(2^32 % n) / 2^32` — under 1 in 40 million for these alphabet sizes — so the
 * loop is not a practical cost.
 */

const RANGE = 2 ** 32;

export function randomInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
        throw new RangeError(`randomInt requires a positive integer, received ${n}`);
    }
    // Only one possible answer; don't burn entropy deciding it.
    if (n === 1) return 0;

    const limit = RANGE - (RANGE % n); // largest exact multiple of n
    const buf = new Uint32Array(1);
    for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % n;
    }
}
