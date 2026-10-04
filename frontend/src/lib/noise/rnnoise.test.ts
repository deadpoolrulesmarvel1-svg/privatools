import { beforeAll, describe, expect, it } from "vitest";
import { loadRnnoise, speech16k } from "@/test/noise";
import { resample } from "./resample";
import { FRAME, RNNOISE_DELAY, type Rnnoise } from "./rnnoise";

let rnnoise: Rnnoise;
let speech: Float32Array;

beforeAll(async () => {
    rnnoise = await loadRnnoise();
    speech = resample(speech16k(), 16000, 48000);
});

function clean(input: Float32Array, cuts: number[] = [input.length]): Float32Array {
    const channel = rnnoise.channel();
    const parts: Float32Array[] = [];
    let at = 0;
    for (const size of cuts) {
        parts.push(channel.process(input.subarray(at, at + size)));
        at += size;
    }
    if (at < input.length) parts.push(channel.process(input.subarray(at)));
    parts.push(channel.flush());
    channel.destroy();
    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let written = 0;
    for (const part of parts) { out.set(part, written); written += part.length; }
    return out;
}

describe("RNNoise, one channel at a time", () => {
    it("works in 480-sample frames and trails its input by two of them", () => {
        expect(FRAME).toBe(480);
        expect(RNNOISE_DELAY).toBe(960);
    });

    it("gives back every sample, lined up with the one it was given", () => {
        const out = clean(speech);
        expect(out.length).toBe(speech.length);
        // On clean speech the output follows the input: the best lag is at zero, give or take RNNoise's high-pass filter.
        let bestLag = 0;
        let best = -Infinity;
        for (let lag = -60; lag <= 60; lag++) {
            let sum = 0;
            for (let i = 2000; i < speech.length - 2000; i++) sum += speech[i] * out[i + lag];
            if (sum > best) { best = sum; bestLag = lag; }
        }
        expect(Math.abs(bestLag)).toBeLessThanOrEqual(2);
    });

    it("cleans the same however the sound arrives", () => {
        const piece = speech.subarray(0, 48000 * 2);
        const whole = clean(piece);
        const byOnes = clean(piece, [1, 1, 1, 479, 480, 481, 7]);
        const byChunks = clean(piece, Array.from({ length: 200 }, (_, i) => 1 + ((i * 7919) % 900)));
        expect(byOnes.length).toBe(piece.length);
        expect(byChunks.length).toBe(piece.length);
        expect(Array.from(byOnes)).toEqual(Array.from(whole));
        expect(Array.from(byChunks)).toEqual(Array.from(whole));
    });

    it("holds back the first two frames until flushed, then returns them all", () => {
        const channel = rnnoise.channel();
        expect(channel.process(speech.subarray(0, 100)).length).toBe(0);
        expect(channel.process(speech.subarray(100, 1000)).length).toBe(0);
        expect(channel.process(speech.subarray(1000, 1500)).length).toBe(1440 - RNNOISE_DELAY);
        expect(channel.flush().length).toBe(1500 - (1440 - RNNOISE_DELAY));
        expect(channel.flush().length).toBe(0);
        channel.destroy();
    });

    it("keeps silence silent and hears no speech in it", () => {
        const channel = rnnoise.channel();
        const out = channel.process(new Float32Array(48000));
        const rest = channel.flush();
        expect(out.length + rest.length).toBe(48000);
        expect(out.every(value => value === 0) && rest.every(value => value === 0)).toBe(true);
        expect(channel.frames).toBe(100);
        expect(channel.speechFrames).toBe(0);
        channel.destroy();
    });

    it("rates synthetic speech as speech", () => {
        const channel = rnnoise.channel();
        channel.process(speech);
        channel.flush();
        expect(channel.frames).toBe(Math.ceil(speech.length / FRAME));
        expect(channel.speechFrames / channel.frames).toBeGreaterThan(0.5);
        channel.destroy();
    });

    it("gives every channel its own state, growing memory as needed", () => {
        const channels = Array.from({ length: 40 }, () => rnnoise.channel());
        for (const channel of channels) expect(channel.process(speech.subarray(0, 4800)).length).toBe(4800 - RNNOISE_DELAY);
        for (const channel of channels) channel.destroy();
    });

    it("refuses to clean once destroyed", () => {
        const channel = rnnoise.channel();
        channel.destroy();
        expect(() => channel.process(new Float32Array(480))).toThrow(/destroyed/);
    });
});
