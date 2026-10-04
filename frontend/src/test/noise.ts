/**
 * Helpers for Voice Noise Remover's tests: the real RNNoise module, taken
 * out of the npm package the same way the build does, synthetic speech
 * (src/test/media/speech.wav, made by make.sh with flite) and seeded noise.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rnnoiseWasm } from "../../scripts/rnnoise-wasm.mjs";
import { Rnnoise } from "@/lib/noise/rnnoise";
import { decodeWav } from "@/lib/noise/wav";

let compiled: Promise<WebAssembly.Module> | null = null;

/** The package's script, as the build reads it. */
export function rnnoisePackageSource(): string {
    return readFileSync(join(process.cwd(), "node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js"), "utf8");
}

export function rnnoiseModule(): Promise<WebAssembly.Module> {
    compiled ??= WebAssembly.compile(rnnoiseWasm(rnnoisePackageSource()));
    return compiled;
}

export async function loadRnnoise(): Promise<Rnnoise> {
    return Rnnoise.instantiate(await rnnoiseModule());
}

/** Seven seconds of flite's synthetic voice, 16 kHz mono. */
export function speech16k(): Float32Array {
    const bytes = readFileSync(join(process.cwd(), "src/test/media/speech.wav"));
    return decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).channels[0];
}

/** A repeatable stream of uniform numbers in [0, 1). */
export function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Gaussian white noise, seeded. */
export function whiteNoise(length: number, seed = 1): Float32Array {
    const next = random(seed);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 2) {
        const radius = Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12)));
        const angle = 2 * Math.PI * next();
        out[i] = radius * Math.cos(angle);
        if (i + 1 < length) out[i + 1] = radius * Math.sin(angle);
    }
    return out;
}

/** Pink noise (3 dB a octave down), seeded: Paul Kellet's filter over white noise. */
export function pinkNoise(length: number, seed = 2): Float32Array {
    const white = whiteNoise(length, seed);
    const out = new Float32Array(length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
        const w = white[i];
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
    }
    return out;
}

export function power(samples: Float32Array, from = 0, to = samples.length): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return sum / Math.max(1, to - from);
}

/** `signal` with `noise` scaled to sit `snrDb` below it. */
export function addNoise(signal: Float32Array, noise: Float32Array, snrDb: number): Float32Array {
    const scale = Math.sqrt(power(signal) / power(noise, 0, signal.length) / 10 ** (snrDb / 10));
    return Float32Array.from(signal, (value, i) => value + noise[i] * scale);
}
