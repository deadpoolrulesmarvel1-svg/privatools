import { beforeAll, describe, expect, it } from "vitest";
import { addNoise, loadRnnoise, pinkNoise, power, speech16k, whiteNoise } from "@/test/noise";
import { NoisePipeline, type PipelineStats } from "./pipeline";
import { resample } from "./resample";
import type { Rnnoise } from "./rnnoise";

let rnnoise: Rnnoise;
let speech48: Float32Array;

beforeAll(async () => {
    rnnoise = await loadRnnoise();
    speech48 = resample(speech16k(), 16000, 48000);
});

interface Run { channels: Float32Array[]; stats: PipelineStats; progress: number[] }

/** Run the pipeline on `input` (one array per channel) in blocks of `block` samples; the result as one array per channel. */
function run(input: Float32Array[], rate: number, strength: number, block = 48000): Run {
    const parts: Int16Array[] = [];
    const progress: number[] = [];
    const pipeline = new NoisePipeline({ rnnoise, sourceChannels: input.length, rate, strength, onOutput: pcm => parts.push(pcm), onProgress: seconds => progress.push(seconds) });
    for (let at = 0; at < input[0].length; at += block) pipeline.push(input.map(channel => channel.subarray(at, at + block)));
    const stats = pipeline.finish();
    const pcm = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { pcm.set(part, at); at += part.length; }
    const channels = Array.from({ length: stats.channels }, (_, c) => Float32Array.from({ length: stats.frames }, (_, i) => pcm[i * stats.channels + c] / 32767));
    return { channels, stats, progress };
}

const db = (value: number) => 10 * Math.log10(value);

/** A recording with pauses: half a second of quiet, the speech, a second of quiet, the speech again, half a second. */
function withPauses(speech: Float32Array): Float32Array {
    const rate = 48000;
    const out = new Float32Array(speech.length * 2 + 2 * rate);
    out.set(speech, rate / 2);
    out.set(speech, rate / 2 + speech.length + rate);
    return out;
}

/** 20 ms windows where the clean speech is at least 50 dB below its loudest window. */
function pauses(clean: Float32Array): number[] {
    const width = 960;
    const powers: number[] = [];
    for (let at = 0; at + width <= clean.length; at += width) powers.push(power(clean, at, at + width));
    const loudest = Math.max(...powers);
    return powers.flatMap((value, k) => value < loudest * 1e-5 ? [k * width] : []);
}

describe("the cleaning pipeline", () => {
    it("at strength 0 gives back the sound itself, every sample, at 48 kHz", () => {
        const input = speech48.subarray(0, 48000 * 2);
        const { channels, stats } = run([input], 48000, 0);
        expect(stats.frames).toBe(input.length);
        let worst = 0;
        for (let i = 0; i < input.length; i++) worst = Math.max(worst, Math.abs(channels[0][i] - input[i]));
        expect(worst).toBeLessThanOrEqual(1 / 32767);
    });

    it.each([[16000, 1], [44100, 2], [48000, 2], [8000, 1], [96000, 1]])("writes exactly the 48 kHz length of %i Hz sound, %i channel(s)", (rate, count) => {
        const length = Math.round(rate * 1.3) + 17;
        const input = Array.from({ length: count }, (_, c) => Float32Array.from({ length }, (_, i) => 0.1 * Math.sin(i / (5 + c))));
        const { stats } = run(input, rate, 1, 10007);
        expect(stats.frames).toBe(Math.ceil((length * 48000) / rate));
        expect(stats.channels).toBe(count);
    });

    it("mixes by strength: 60% is six tenths of the cleaned sound and four of the original", () => {
        const input = addNoise(speech48.subarray(0, 48000 * 2), whiteNoise(96000, 5), 5);
        const full = run([input], 48000, 1).channels[0];
        const none = run([input], 48000, 0).channels[0];
        const partial = run([input], 48000, 0.6).channels[0];
        let worst = 0;
        for (let i = 0; i < partial.length; i++) worst = Math.max(worst, Math.abs(partial[i] - (0.6 * full[i] + 0.4 * none[i])));
        expect(worst).toBeLessThan(2.5 / 32767);
    });

    it("cleans each channel on its own and writes them interleaved, left first", () => {
        const left = addNoise(speech48.subarray(0, 48000 * 2), whiteNoise(96000, 6), 5);
        const right = new Float32Array(left.length);
        const { channels, stats } = run([left, right], 48000, 1);
        expect(stats.channels).toBe(2);
        expect(power(channels[0])).toBeGreaterThan(1e-4);
        expect(channels[1].every(value => value === 0)).toBe(true);
    });

    it("mixes sound with more than two channels to mono, centre first and no LFE", () => {
        const length = 48000;
        const centre = Float32Array.from({ length }, (_, i) => 0.5 * Math.sin(i / 9));
        const six = [0, 1, 2, 3, 4, 5].map(c => c === 2 ? centre : c === 3 ? new Float32Array(length).fill(0.9) : new Float32Array(length));
        const { channels, stats } = run(six, 48000, 0);
        expect(stats.channels).toBe(1);
        expect(stats.sourceChannels).toBe(6);
        for (let i = 1000; i < length; i += 997) expect(channels[0][i]).toBeCloseTo(centre[i] / 2.7, 4);
    });

    it("makes anything that isn't a number silent, and goes on cleaning", () => {
        const input = speech48.slice(0, 48000);
        input.fill(Number.NaN, 1000, 1200);
        input[5000] = Number.POSITIVE_INFINITY;
        const { channels, stats } = run([input], 48000, 1);
        expect(Number.isFinite(stats.outputPower)).toBe(true);
        expect(channels[0].every(Number.isFinite)).toBe(true);
        expect(power(channels[0], 24000, 48000)).toBeGreaterThan(1e-5);
    });

    it("reports progress in seconds of the sound, up to its length", () => {
        const { progress } = run([new Float32Array(44100 * 2)], 44100, 1, 30000);
        expect(progress.length).toBeGreaterThan(3);
        expect(progress.every((value, i) => i === 0 || value > progress[i - 1])).toBe(true);
        expect(progress[progress.length - 1]).toBeCloseTo(2, 6);
    });

    it("measures the sound's loudest sample, so a silent file can be told apart", () => {
        expect(run([new Float32Array(48000)], 48000, 1).stats.inputPeak).toBe(0);
        expect(run([speech48.subarray(0, 48000)], 48000, 1).stats.inputPeak).toBeGreaterThan(0.1);
    });
});

describe("how much noise it takes away", () => {
    const quality = (clean: Float32Array, noisy: Float32Array) => {
        const { channels, stats } = run([noisy], 48000, 1);
        const out = channels[0];
        const noise = Float32Array.from(noisy, (value, i) => value - clean[i]);
        const error = Float32Array.from(out, (value, i) => value - clean[i]);
        const quiet = pauses(clean);
        let before = 0;
        let after = 0;
        for (const at of quiet) { before += power(noisy, at, at + 960); after += power(out, at, at + 960); }
        return {
            inputSnr: db(power(clean) / power(noise)),
            outputSnr: db(power(clean) / power(error)),
            /** How much quieter the pauses are: the noise floor. */
            floor: db(after / before),
            speech: stats.speechFrames / stats.heardFrames,
        };
    };

    // Measured on 2026-10-04 with RNNoise from @shiguredo/rnnoise-wasm 2025.1.5, at full strength: white noise at 5 dB SNR
    // came out at 13.5 dB (8.5 dB better) with the pauses 38.2 dB quieter; pink noise at 11.1 dB (6.1 dB better), pauses
    // 31.3 dB quieter. The thresholds leave about 2 dB, and 10 dB on the pauses, for other engines' arithmetic.
    it("lifts speech out of white noise at 5 dB SNR", () => {
        const clean = withPauses(speech48);
        const result = quality(clean, addNoise(clean, whiteNoise(clean.length, 21), 5));
        expect(result.inputSnr).toBeCloseTo(5, 1);
        expect(result.outputSnr - result.inputSnr).toBeGreaterThan(6);
        expect(result.floor).toBeLessThan(-25);
    });

    it("lifts speech out of pink noise at 5 dB SNR", () => {
        const clean = withPauses(speech48);
        const result = quality(clean, addNoise(clean, pinkNoise(clean.length, 22), 5));
        expect(result.outputSnr - result.inputSnr).toBeGreaterThan(4);
        expect(result.floor).toBeLessThan(-20);
    });
});
