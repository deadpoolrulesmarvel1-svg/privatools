import { describe, expect, it } from "vitest";
import { noiseFloor, pausesIn, snapToPauses, tightenToSpeech } from "./timing";
import { SAMPLE_RATE } from "./windows";

/** A window of `seconds` with a tone in each [from, to) span and `noise` everywhere. */
function window(seconds: number, spans: [number, number][], noise = 0): Float32Array {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    return Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => {
        const t = i / SAMPLE_RATE;
        const voiced = spans.some(([from, to]) => t >= from && t < to);
        return (voiced ? 0.25 * Math.sin(2 * Math.PI * 180 * t) : 0) + noise * random();
    });
}

describe("tightening a segment to the speech in it", () => {
    // Where the synthetic clip's three sentences really are, and the times Whisper Base gave them.
    const audio = window(12, [[1.22, 3.4], [5.32, 7.92], [9.24, 11.5]]);
    const floor = noiseFloor(audio);

    it("moves a start that Whisper put in the silence before the words up to them", () => {
        const [start, end] = tightenToSpeech(audio, 0, 4, floor)!;
        expect(start).toBeGreaterThan(1.0);
        expect(start).toBeLessThan(1.22);
        expect(end).toBeGreaterThan(3.4);
        expect(end).toBeLessThan(3.8);
    });

    it("never moves a time outward, past what Whisper gave", () => {
        const [start, end] = tightenToSpeech(audio, 5.4, 7.5, floor)!;
        expect(start).toBe(5.4);
        expect(end).toBe(7.5);
    });

    it("keeps Whisper's times when the stretch has no clear speech in it", () => {
        expect(tightenToSpeech(audio, 3.5, 5.2, floor)).toBeNull();
        // Music or noise from end to end: nothing quieter to tell speech from.
        const loud = window(12, [[0, 12]]);
        expect(tightenToSpeech(loud, 0, 4, noiseFloor(loud))).toBeNull();
    });

    it("finds speech over a noise floor", () => {
        const noisy = window(12, [[1.22, 3.4], [5.32, 7.92]], 0.02);
        const [start, end] = tightenToSpeech(noisy, 4, 8, noiseFloor(noisy))!;
        expect(start).toBeGreaterThan(5.0);
        expect(start).toBeLessThan(5.32);
        expect(end).toBeGreaterThan(7.92);
        expect(end).toBeLessThanOrEqual(8);
    });

    it("keeps a cue up a moment after the voice stops, never past the segment", () => {
        const [, end] = tightenToSpeech(audio, 8, 11.63, floor)!;
        expect(end).toBeGreaterThanOrEqual(11.5);
        expect(end).toBeLessThanOrEqual(11.63);
    });
});

describe("moving a boundary between two segments into the pause between them", () => {
    // The synthetic talk's first three sentences, and the boundaries Whisper Tiny gave them.
    const talk = window(16, [[1.02, 4.5], [6.56, 10.06], [12.04, 15.02]]);
    const floor = noiseFloor(talk);

    it("finds the pauses between sentences", () => {
        const found = pausesIn(talk, floor);
        expect(found.length).toBeGreaterThanOrEqual(2);
        const [, end] = found.find(([start]) => start > 4 && start < 5)!;
        expect(end).toBeGreaterThan(6.3);
        expect(end).toBeLessThanOrEqual(6.56);
    });

    it("moves a boundary Whisper put in the next sentence back into the pause before it", () => {
        const segments = [{ start: 0, end: 7 }, { start: 7, end: 10.25 }, { start: 10.25, end: 15.5 }];
        snapToPauses(segments, pausesIn(talk, floor));
        expect(segments[0].end).toBeGreaterThan(4.5);
        expect(segments[0].end).toBeLessThan(5);
        expect(segments[1].start).toBeGreaterThan(6.2);
        expect(segments[1].start).toBeLessThanOrEqual(6.56);
        // A boundary already in a pause stays in it.
        expect(segments[1].end).toBeGreaterThanOrEqual(10.06);
        expect(segments[2].start).toBeLessThanOrEqual(12.04);
        expect(segments[2].start).toBeGreaterThanOrEqual(10.06);
    });

    it("leaves a boundary with no pause near it, and segments already apart", () => {
        const segments = [{ start: 1, end: 3 }, { start: 3, end: 4.4 }, { start: 7, end: 9 }];
        snapToPauses(segments, pausesIn(talk, floor));
        expect(segments).toEqual([{ start: 1, end: 3 }, { start: 3, end: 4.4 }, { start: 7, end: 9 }]);
    });

    it("finds no pauses where there is no silence to tell from speech", () => {
        const loud = window(12, [[0, 12]]);
        expect(pausesIn(loud, noiseFloor(loud))).toEqual([]);
    });
});
