/**
 * The cleaning, a block at a time, in the noise remover's worker.
 *
 * Sound arrives as continuous blocks at its own rate, one array per channel
 * (stitch.ts has joined the pieces). Each block is converted to 48 kHz
 * (resample.ts), each channel goes through its own RNNoise (rnnoise.ts), and
 * the strength mixes the cleaned sound with the 48 kHz original, sample for
 * sample: 100% is the cleaned sound alone, 70% keeps 30% of the original,
 * noise and all. The result leaves as 16-bit samples, interleaved, block by
 * block, so memory holds about a block however long the recording is.
 *
 * Mono stays mono and stereo stays stereo, each channel cleaned on its own.
 * More channels than two (5.1 film sound, say) are mixed to mono first, the
 * centre channel at full weight and the low-frequency channel left out, as
 * speech sits in the centre.
 */
import { RNNOISE_RATE, type ChannelDenoiser, type Rnnoise } from "./rnnoise";
import { Resampler } from "./resample";
import { toPcm16 } from "./wav";

export interface PipelineStats {
    /** Sample frames written, at 48 kHz. */
    frames: number;
    /** Channels written: 1 or 2. */
    channels: number;
    /** Channels the sound had. */
    sourceChannels: number;
    /** The loudest sample of the sound, 0 to 1 and over. */
    inputPeak: number;
    /** Mean square of the sound and of the result, over every channel. */
    inputPower: number;
    outputPower: number;
    /** RNNoise's 10 ms frames, and how many it rated as speech. */
    heardFrames: number;
    speechFrames: number;
    /** Samples held at full scale in the result. */
    clipped: number;
}

export interface PipelineOptions {
    rnnoise: Rnnoise;
    /** Channels in the blocks pushed. */
    sourceChannels: number;
    /** Their sample rate. */
    rate: number;
    /** How much of the cleaned sound the result holds, 0 to 1; the rest is the original. */
    strength: number;
    /** Each block of the result, interleaved 16-bit. */
    onOutput: (pcm: Int16Array) => void;
    /** Seconds of the sound processed so far. */
    onProgress?: (seconds: number) => void;
}

/** How much input is cleaned between progress reports: half a second. */
const STEP_SECONDS = 0.5;

/** Weights for mixing to mono: 5.1's centre at full weight and its LFE left out; otherwise every channel alike. */
function monoWeights(count: number): number[] {
    const weights = count === 6 ? [0.5, 0.5, 1, 0, 0.35, 0.35] : Array.from({ length: count }, () => 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => weight / total);
}

export class NoisePipeline {
    readonly outputChannels: number;
    private readonly resamplers: Resampler[];
    private readonly denoisers: ChannelDenoiser[];
    /** The 48 kHz original waiting for its cleaned samples, per channel. */
    private readonly waiting: Float32Array[];
    private readonly weights: number[] | null;
    private readonly strength: number;
    private consumed = 0;
    private readonly stats: PipelineStats;
    private sumIn = 0;
    private sumOut = 0;

    constructor(private readonly options: PipelineOptions) {
        const { rnnoise, sourceChannels, rate } = options;
        this.outputChannels = sourceChannels > 2 ? 1 : sourceChannels;
        this.weights = sourceChannels > 2 ? monoWeights(sourceChannels) : null;
        this.strength = Math.min(1, Math.max(0, options.strength));
        this.resamplers = Array.from({ length: this.outputChannels }, () => new Resampler(rate, RNNOISE_RATE));
        this.denoisers = [];
        try {
            for (let c = 0; c < this.outputChannels; c++) this.denoisers.push(rnnoise.channel());
        } catch (error) {
            this.destroy();
            throw error;
        }
        this.waiting = Array.from({ length: this.outputChannels }, () => new Float32Array(0));
        this.stats = { frames: 0, channels: this.outputChannels, sourceChannels, inputPeak: 0, inputPower: 0, outputPower: 0, heardFrames: 0, speechFrames: 0, clipped: 0 };
    }

    /** Clean the next block of the sound. */
    push(channels: readonly Float32Array[]): void {
        const length = channels[0]?.length ?? 0;
        const step = Math.max(1, Math.round(STEP_SECONDS * this.options.rate));
        for (let at = 0; at < length; at += step) {
            const end = Math.min(length, at + step);
            const block = this.prepare(channels, at, end);
            this.clean(block.map((samples, c) => this.resamplers[c].push(samples)), false);
            this.consumed += end - at;
            this.options.onProgress?.(this.consumed / this.options.rate);
        }
    }

    /** Bring out the end of the sound, every sample of it, and say what was done. */
    finish(): PipelineStats {
        this.clean(this.resamplers.map(resampler => resampler.flush()), true);
        for (const denoiser of this.denoisers) {
            this.stats.heardFrames += denoiser.frames;
            this.stats.speechFrames += denoiser.speechFrames;
        }
        const samples = this.stats.frames * this.outputChannels;
        this.stats.inputPower = samples ? this.sumIn / samples : 0;
        this.stats.outputPower = samples ? this.sumOut / samples : 0;
        this.destroy();
        return { ...this.stats };
    }

    destroy(): void {
        for (const denoiser of this.denoisers) denoiser.destroy();
        this.denoisers.length = 0;
    }

    /** The channels to clean for input [from, to): copied, mixed down if there are more than two, anything not a number made silent. */
    private prepare(channels: readonly Float32Array[], from: number, to: number): Float32Array[] {
        const length = to - from;
        if (this.weights) {
            const mono = new Float32Array(length);
            this.weights.forEach((weight, c) => {
                if (!weight || !channels[c]) return;
                const channel = channels[c];
                for (let i = 0; i < length; i++) {
                    const value = channel[from + i];
                    if (Number.isFinite(value)) mono[i] += value * weight;
                }
            });
            return [mono];
        }
        return Array.from({ length: this.outputChannels }, (_, c) => {
            const source = channels[c] ?? channels[0];
            const copy = source.slice(from, to);
            for (let i = 0; i < length; i++) if (!Number.isFinite(copy[i])) copy[i] = 0;
            return copy;
        });
    }

    /** Clean 48 kHz samples, mix in the original by strength and write the result. */
    private clean(blocks: Float32Array[], last: boolean): void {
        const cleaned = blocks.map((samples, c) => {
            this.waiting[c] = join(this.waiting[c], samples);
            const ready = this.denoisers[c].process(samples);
            return last ? join(ready, this.denoisers[c].flush()) : ready;
        });
        const count = cleaned[0]?.length ?? 0;
        if (!count) return;
        const strength = this.strength;
        const mixed = cleaned.map((clean, c) => {
            const original = this.waiting[c];
            const out = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const before = original[i];
                const after = strength * clean[i] + (1 - strength) * before;
                out[i] = after;
                const size = before < 0 ? -before : before;
                if (size > this.stats.inputPeak) this.stats.inputPeak = size;
                this.sumIn += before * before;
                this.sumOut += after * after;
            }
            this.waiting[c] = original.slice(count);
            return out;
        });
        const { pcm, clipped } = toPcm16(mixed);
        this.stats.clipped += clipped;
        this.stats.frames += count;
        this.options.onOutput(pcm);
    }
}

function join(a: Float32Array, b: Float32Array): Float32Array {
    if (!a.length) return b;
    if (!b.length) return a;
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
