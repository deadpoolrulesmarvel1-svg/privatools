import { describe, expect, it } from "vitest";
import { planWindows, SAMPLE_RATE, WINDOW_SECONDS } from "./windows";

/** Synthetic audio: a 220 Hz tone where `loud` says so, digital silence elsewhere. */
function audio(seconds: number, loud: (t: number) => boolean): Float32Array {
    const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
    for (let i = 0; i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        if (loud(t)) samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t);
    }
    return samples;
}

const seconds = (samples: number) => samples / SAMPLE_RATE;

function expectContiguous(windows: { start: number; end: number }[], length: number) {
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(length);
    for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBe(windows[i - 1].end);
    for (const window of windows) {
        expect(window.end).toBeGreaterThan(window.start);
        expect(seconds(window.end - window.start)).toBeLessThanOrEqual(WINDOW_SECONDS);
    }
}

describe("planning recognition windows", () => {
    it("has nothing to plan for no audio", () => {
        expect(planWindows(new Float32Array(0))).toEqual([]);
    });

    it("keeps audio up to 30 seconds in one window", () => {
        const samples = audio(12, () => true);
        expect(planWindows(samples)).toEqual([{ start: 0, end: samples.length, silent: false }]);
    });

    it("cuts long speech in the pauses, never mid-sound, in windows of at most 30 seconds", () => {
        // Speech-like bursts: 4.5 s of sound, then 0.6 s of silence, over 100 s.
        const pause = (t: number) => t % 5.1 >= 4.5;
        const samples = audio(100, t => !pause(t));
        const windows = planWindows(samples);
        expectContiguous(windows, samples.length);
        for (const window of windows.slice(0, -1)) expect(pause(seconds(window.end))).toBe(true);
    });

    it("still cuts audio with no pauses at all", () => {
        const samples = audio(95, () => true);
        const windows = planWindows(samples);
        expect(windows.length).toBe(4);
        expectContiguous(windows, samples.length);
    });

    it("leaves no sliver of audio for a window of its own", () => {
        const samples = audio(30.4, t => !(t > 29.95 && t < 30.05));
        const windows = planWindows(samples);
        expectContiguous(windows, samples.length);
        for (const window of windows) expect(seconds(window.end - window.start)).toBeGreaterThanOrEqual(2);
    });

    it("marks windows of silence, so no time is spent recognising them", () => {
        // 40 s of silence, then 20 s of sound.
        const samples = audio(60, t => t >= 40);
        const windows = planWindows(samples);
        expectContiguous(windows, samples.length);
        expect(windows[0].silent).toBe(true);
        expect(windows[windows.length - 1].silent).toBe(false);
        expect(windows.filter(window => !window.silent).every(window => seconds(window.end) > 40)).toBe(true);
    });

    it("does not mistake quiet speech for silence", () => {
        const samples = audio(10, () => true).map(value => value * 0.02);
        expect(planWindows(samples)[0].silent).toBe(false);
    });
});
