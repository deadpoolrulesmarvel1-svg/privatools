import { beforeAll, describe, expect, it } from "vitest";
import { random, speech16k, whiteNoise } from "@/test/noise";
import { resample } from "./resample";
import { Stitcher, type DecodedPiece } from "./stitch";

const RATE = 48000;
let reference: Float32Array;

beforeAll(() => {
    // Twenty seconds: synthetic speech, a quiet hiss under it, and a pause or two.
    const speech = resample(speech16k(), 16000, RATE);
    const hiss = whiteNoise(20 * RATE, 3);
    reference = Float32Array.from(hiss, (value, i) => 0.003 * value + (i % (9 * RATE) < speech.length ? speech[i % (9 * RATE)] : 0));
});

interface Decoder {
    /** Samples the decoder shifts piece k by: its first sample is this much later in the sound than its timestamp. */
    offset?: (k: number) => number;
    /** Seconds at the start and end of each piece that come out wrong. */
    settle?: number;
    unfinished?: number;
}

/** The pieces a browser would decode, a few seconds at a time with a lead, from `signal`, whose index 0 is time `origin`. */
function decodePieces(signal: Float32Array, { pieceSeconds = 4, lead = 1, origin = 0, offset = () => 0, settle = 0.2, unfinished = 0.05 }: Decoder & { pieceSeconds?: number; lead?: number; origin?: number } = {}): DecodedPiece[] {
    const noise = random(11);
    const pieces: DecodedPiece[] = [];
    const total = signal.length / RATE + origin;
    for (let k = 0, start = origin; start < total - 1e-9; k++, start += pieceSeconds) {
        const pieceLead = k === 0 ? 0 : Math.min(lead, start - origin);
        const from = Math.round((start - pieceLead - origin) * RATE) + offset(k);
        const to = Math.min(signal.length, Math.round((start + pieceSeconds - origin) * RATE));
        const decoded = signal.slice(Math.max(0, from), to);
        const last = to === signal.length;
        // A decoder starting cold gets its first frames wrong; the last frame of a piece misses what the next would add.
        if (k > 0) for (let i = 0; i < settle * RATE && i < decoded.length; i++) decoded[i] = noise() - 0.5;
        if (!last) for (let i = Math.max(0, decoded.length - unfinished * RATE); i < decoded.length; i++) decoded[i] = noise() - 0.5;
        pieces.push({ channels: [decoded], start, lead: pieceLead });
    }
    return pieces;
}

function stitch(pieces: DecodedPiece[], channels = 1): { out: Float32Array[]; stitcher: Stitcher } {
    const stitcher = new Stitcher(RATE, channels);
    const parts: Float32Array[][] = [];
    for (const piece of pieces) {
        const ready = stitcher.push(piece);
        if (ready) parts.push(ready);
    }
    parts.push(stitcher.finish());
    const out = Array.from({ length: channels }, (_, c) => {
        const joined = new Float32Array(parts.reduce((sum, part) => sum + part[c].length, 0));
        let at = 0;
        for (const part of parts) { joined.set(part[c], at); at += part[c].length; }
        return joined;
    });
    return { out, stitcher };
}

function largestError(actual: Float32Array, expected: Float32Array): number {
    let worst = 0;
    for (let i = 0; i < Math.max(actual.length, expected.length); i++) worst = Math.max(worst, Math.abs((actual[i] ?? 0) - (expected[i] ?? 0)));
    return worst;
}

describe("joining pieces decoded one at a time", () => {
    it("rebuilds the sound exactly when the decoder shifts each piece the same way (Opus drops 312 samples)", () => {
        const { out, stitcher } = stitch(decodePieces(reference, { offset: k => (k ? 312 : 0) }));
        expect(out[0].length).toBe(reference.length);
        expect(largestError(out[0], reference)).toBeLessThan(1e-6);
        expect(stitcher.stats.joins).toBe(4);
        expect(stitcher.stats.matched).toBe(4);
        expect(stitcher.stats.largestOffset).toBe(312);
    });

    it("finds a different shift at every join, either way", () => {
        const shifts = [0, -1500, 2200, 7, -4000];
        const { out, stitcher } = stitch(decodePieces(reference, { offset: k => shifts[k] }));
        expect(largestError(out[0], reference)).toBeLessThan(1e-6);
        expect(stitcher.stats.matched).toBe(4);
    });

    it("leaves out the priming before the file's timeline starts", () => {
        // An MP4's first piece starts 2112 samples at 44.1 kHz (48 ms) before zero; its edit list skips them.
        const { out } = stitch(decodePieces(reference, { origin: -0.048 }));
        expect(largestError(out[0], reference.subarray(Math.round(0.048 * RATE)))).toBeLessThan(1e-6);
    });

    it("puts silence first when the file's sound starts late", () => {
        const { out } = stitch(decodePieces(reference.subarray(0, 6 * RATE), { origin: 0.5 }));
        const expected = new Float32Array(Math.round(6.5 * RATE));
        expected.set(reference.subarray(0, 6 * RATE), Math.round(0.5 * RATE));
        expect(largestError(out[0], expected)).toBeLessThan(1e-6);
    });

    it("joins over silence where the timestamps say, shifted as the last matched piece was", () => {
        const quiet = reference.slice();
        // Silence around the second join (8 s): its lead has nothing to match.
        quiet.fill(0, Math.round(6.5 * RATE), Math.round(8.2 * RATE));
        const { out, stitcher } = stitch(decodePieces(quiet, { offset: k => (k ? 312 : 0) }));
        expect(stitcher.stats.silent).toBe(1);
        expect(stitcher.stats.matched).toBe(3);
        expect(largestError(out[0], quiet)).toBeLessThan(1e-6);
    });

    it("places a piece that matches nothing by its timestamps", () => {
        const pieces = decodePieces(reference);
        // The third piece decodes as something else entirely.
        pieces[2] = { ...pieces[2], channels: [whiteNoise(pieces[2].channels[0].length, 99).map(value => value * 0.2)] };
        const { out, stitcher } = stitch(pieces);
        expect(stitcher.stats.unmatched).toBeGreaterThanOrEqual(1);
        expect(out[0].length).toBe(reference.length);
    });

    it("lays pieces without a lead end to end", () => {
        const pieces: DecodedPiece[] = [0, 1, 2].map(k => ({ channels: [reference.slice(k * 3 * RATE, (k + 1) * 3 * RATE)], start: k * 3, lead: 0 }));
        const { out, stitcher } = stitch(pieces);
        expect(largestError(out[0], reference.subarray(0, 9 * RATE))).toBe(0);
        expect(stitcher.stats.joins).toBe(0);
    });

    it("puts silence where a piece couldn't be decoded", () => {
        const stitcher = new Stitcher(RATE, 1);
        const parts: Float32Array[] = [];
        const take = (ready: Float32Array[] | null) => { if (ready) parts.push(ready[0]); };
        take(stitcher.push({ channels: [reference.slice(0, 4 * RATE)], start: 0, lead: 0 }));
        take(stitcher.gap(4));
        take(stitcher.push({ channels: [reference.slice(7 * RATE, 12 * RATE)], start: 8, lead: 1 }));
        parts.push(stitcher.finish()[0]);
        const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        for (const part of parts) { out.set(part, at); at += part.length; }
        expect(out.length).toBe(12 * RATE);
        expect(largestError(out.subarray(0, 4 * RATE), reference.subarray(0, 4 * RATE))).toBe(0);
        expect(out.subarray(4 * RATE, Math.round(7.4 * RATE)).every(value => value === 0)).toBe(true);
        expect(largestError(out.subarray(Math.round(7.6 * RATE)), reference.subarray(Math.round(7.6 * RATE), 12 * RATE))).toBeLessThan(1e-6);
    });

    it("joins both channels of stereo sound at the same place", () => {
        const right = Float32Array.from(reference, value => -0.5 * value);
        const left = decodePieces(reference, { offset: k => (k ? 312 : 0) });
        const rightPieces = decodePieces(right, { offset: k => (k ? 312 : 0) });
        const pieces = left.map((piece, k) => ({ ...piece, channels: [piece.channels[0], rightPieces[k].channels[0]] }));
        const { out } = stitch(pieces, 2);
        expect(largestError(out[0], reference)).toBeLessThan(1e-6);
        expect(largestError(out[1], right)).toBeLessThan(1e-6);
    });

    it("keeps a steady tone in time rather than slipping by whole periods", () => {
        // 440 Hz: a period of 109.09 samples, so only the true offset fits exactly.
        const tone = Float32Array.from({ length: 16 * RATE }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / RATE));
        const { out } = stitch(decodePieces(tone, { offset: k => (k ? 312 : 0) }));
        expect(largestError(out[0], tone)).toBeLessThan(1e-5);
    });

    it("mixes extra channels in, and copies one that's missing", () => {
        const stitcher = new Stitcher(RATE, 1);
        const ready = stitcher.push({ channels: [new Float32Array(3 * RATE).fill(0.2), new Float32Array(3 * RATE).fill(0.4)], start: 0, lead: 0 });
        expect(ready![0][0]).toBeCloseTo(0.3, 6);
        const stereo = new Stitcher(RATE, 2);
        const both = stereo.push({ channels: [new Float32Array(3 * RATE).fill(0.25)], start: 0, lead: 0 });
        expect(both![1][0]).toBe(0.25);
    });
});
