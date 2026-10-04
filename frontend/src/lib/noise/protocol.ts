/** Messages between the page (engine.ts) and Voice Noise Remover's worker (noise.worker.ts). */
import type { PipelineStats } from "./pipeline";
import type { StitchStats } from "./stitch";

export type NoiseRequest =
    /** RNNoise, compiled on the page, and how much of the cleaned sound to keep. */
    | { type: "start"; module: WebAssembly.Module; strength: number }
    /** Decoded sound, as source.ts gives it. */
    | { type: "pcm"; channels: Float32Array[]; rate: number; start: number; lead: number }
    /** A WAV piece's bytes, read in the worker. */
    | { type: "wav"; bytes: ArrayBuffer; start: number }
    /** Silence in place of a stretch the browser couldn't decode. */
    | { type: "gap"; seconds: number }
    | { type: "end" };

export interface NoiseStats extends PipelineStats {
    /** The rate the sound arrived at, before conversion to 48 kHz. */
    rate: number;
    stitch: StitchStats;
}

export type NoiseReply =
    /** The worker's script has loaded. */
    | { type: "loaded" }
    /** RNNoise is ready. */
    | { type: "ready" }
    /** One piece of sound has been cleaned. */
    | { type: "taken" }
    | { type: "progress"; seconds: number }
    | { type: "done"; wav: Blob; stats: NoiseStats }
    | { type: "error"; name: string; message: string };
