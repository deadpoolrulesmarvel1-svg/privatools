import { describe, expect, it } from "vitest";
import { resample, Resampler } from "./resample";

const sine = (rate: number, seconds: number, frequency: number, amplitude = 0.5) =>
    Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate));

/** Error against the ideal signal, in dB of the signal, away from both ends. */
function errorDb(actual: Float32Array, ideal: (i: number) => number, margin = 200): number {
    let error = 0;
    let power = 0;
    for (let i = margin; i < actual.length - margin; i++) {
        const want = ideal(i);
        error += (actual[i] - want) ** 2;
        power += want * want;
    }
    return 10 * Math.log10(error / power);
}

const rms = (samples: Float32Array, margin = 200) => {
    let sum = 0;
    for (let i = margin; i < samples.length - margin; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (samples.length - 2 * margin));
};

describe("resampling to 48 kHz and back", () => {
    it.each([
        [16000, 1000], [44100, 1000], [44100, 10000], [8000, 440], [22050, 3000], [11025, 2000], [32000, 7000], [24000, 9000],
    ])("up from %i Hz keeps a %i Hz tone", (rate, frequency) => {
        const input = sine(rate, 0.5, frequency);
        const out = resample(input, rate, 48000);
        expect(out.length).toBe(Math.ceil((input.length * 48000) / rate));
        expect(errorDb(out, i => 0.5 * Math.sin((2 * Math.PI * frequency * i) / 48000))).toBeLessThan(-60);
    });

    it.each([[96000, 1000], [88200, 5000], [192000, 3000]])("down from %i Hz keeps a %i Hz tone", (rate, frequency) => {
        const input = sine(rate, 0.5, frequency);
        const out = resample(input, rate, 48000);
        expect(out.length).toBe(Math.ceil((input.length * 48000) / rate));
        expect(errorDb(out, i => 0.5 * Math.sin((2 * Math.PI * frequency * i) / 48000))).toBeLessThan(-60);
    });

    it("removes what 48 kHz can't hold when converting down, instead of folding it back", () => {
        // 30 kHz would alias to 18 kHz at 48 kHz.
        const out = resample(sine(96000, 0.5, 30000), 96000, 48000);
        expect(20 * Math.log10(rms(out) / (0.5 / Math.SQRT2))).toBeLessThan(-60);
    });

    it("converts 48 kHz down to another rate too", () => {
        const out = resample(sine(48000, 0.5, 1000), 48000, 16000);
        expect(out.length).toBe(8000);
        expect(errorDb(out, i => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 16000), 100)).toBeLessThan(-60);
    });

    it("goes there and back with little change to speech-band sound", () => {
        const rate = 16000;
        const input = Float32Array.from({ length: rate }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / rate) + 0.2 * Math.sin((2 * Math.PI * 2100 * i) / rate + 1));
        const back = resample(resample(input, rate, 48000), 48000, rate);
        expect(back.length).toBe(input.length);
        expect(errorDb(back, i => input[i], 100)).toBeLessThan(-60);
    });

    it("passes a constant at exactly its level", () => {
        const out = resample(new Float32Array(44100).fill(0.25), 44100, 48000);
        for (let i = 200; i < out.length - 200; i++) expect(Math.abs(out[i] - 0.25)).toBeLessThan(1e-5);
    });

    it("gives the same output however the input is cut into blocks", () => {
        const input = sine(44100, 1, 1234);
        const whole = resample(input, 44100, 48000);
        const resampler = new Resampler(44100, 48000);
        const parts: Float32Array[] = [];
        let seed = 7;
        for (let at = 0; at < input.length;) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            const size = 1 + (seed % 3000);
            parts.push(resampler.push(input.subarray(at, at + size)));
            at += size;
        }
        parts.push(resampler.flush());
        const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        for (const part of parts) { joined.set(part, at); at += part.length; }
        expect(joined.length).toBe(whole.length);
        expect(Array.from(joined)).toEqual(Array.from(whole));
    });

    it("gives ceil(n × 48000 / rate) samples for n in, at any length", () => {
        for (const rate of [8000, 22050, 44100, 96000]) {
            for (const n of [0, 1, 7, 147, 1000, 44101]) {
                expect(resample(new Float32Array(n), rate, 48000).length).toBe(Math.ceil((n * 48000) / rate));
            }
        }
    });

    it("leaves 48 kHz sound as it is", () => {
        const input = sine(48000, 0.1, 500);
        const resampler = new Resampler(48000, 48000);
        expect(resampler.identity).toBe(true);
        expect(Array.from(resampler.push(input))).toEqual(Array.from(input));
        expect(resampler.flush().length).toBe(0);
    });

    it("handles an odd rate, between precomputed phases", () => {
        const out = resample(sine(22222, 0.5, 1500), 22222, 48000);
        expect(out.length).toBe(Math.ceil(11111 * 48000 / 22222));
        expect(errorDb(out, i => 0.5 * Math.sin((2 * Math.PI * 1500 * i) / 48000))).toBeLessThan(-55);
    });

    it("refuses a rate that isn't a whole number above zero", () => {
        expect(() => new Resampler(0, 48000)).toThrow(RangeError);
        expect(() => new Resampler(44100.5, 48000)).toThrow(RangeError);
    });
});
