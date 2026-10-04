/**
 * What Voice Noise Remover's worker does with each message (noise.worker.ts
 * only connects it to the worker's port, so tests can run it in place): it
 * joins the decoded pieces (stitch.ts), reads WAV pieces itself (wav.ts),
 * converts to 48 kHz, cleans each channel with RNNoise and mixes by strength
 * (pipeline.ts), and writes a 16-bit WAV a part at a time, as Blobs the
 * browser may keep out of memory. The page compiles RNNoise, where the page's
 * policy allows WebAssembly, and sends the compiled module; here it is only
 * instantiated.
 */
import { NoisePipeline } from "./pipeline";
import type { NoiseReply, NoiseRequest } from "./protocol";
import { Rnnoise, RNNOISE_RATE } from "./rnnoise";
import { Stitcher } from "./stitch";
import { decodeWav, wavHeader } from "./wav";

/** About 2 MB of samples to a Blob part. */
const PART_SAMPLES = 1 << 20;

export interface NoiseWorkerCore {
    /** Handle one message; replies go to `post`. Messages must be handled one at a time, in order. */
    handle(message: NoiseRequest): Promise<void>;
}

export function createNoiseWorkerCore(post: (reply: NoiseReply) => void): NoiseWorkerCore {
    let rnnoise: Rnnoise | null = null;
    let strength = 1;
    let stitcher: Stitcher | null = null;
    let pipeline: NoisePipeline | null = null;
    let rate = 0;
    const parts: Blob[] = [];
    let pending: Int16Array[] = [];
    let pendingSamples = 0;

    const closePart = () => {
        if (pending.length) parts.push(new Blob(pending as BlobPart[]));
        pending = [];
        pendingSamples = 0;
    };
    const keep = (pcm: Int16Array) => {
        pending.push(pcm);
        pendingSamples += pcm.length;
        if (pendingSamples >= PART_SAMPLES) closePart();
    };
    /** The stitcher and pipeline, made for the first piece's rate and channels. */
    const setUp = (sourceRate: number, channels: number) => {
        if (stitcher) return;
        if (!rnnoise) throw new Error("RNNoise isn’t ready");
        rate = sourceRate;
        stitcher = new Stitcher(sourceRate, channels);
        pipeline = new NoisePipeline({
            rnnoise, sourceChannels: channels, rate: sourceRate, strength, onOutput: keep,
            onProgress: seconds => post({ type: "progress", seconds }),
        });
    };
    const clean = (blocks: Float32Array[] | null) => {
        if (blocks && blocks[0]?.length) pipeline!.push(blocks);
    };

    return {
        async handle(message) {
            switch (message.type) {
                case "start":
                    rnnoise = await Rnnoise.instantiate(message.module);
                    strength = message.strength;
                    post({ type: "ready" });
                    return;
                case "pcm":
                    setUp(message.rate, message.channels.length);
                    clean(stitcher!.push({ channels: message.channels, start: message.start, lead: message.lead }));
                    post({ type: "taken" });
                    return;
                case "wav": {
                    const wav = decodeWav(message.bytes);
                    setUp(wav.sampleRate, wav.channels.length);
                    clean(stitcher!.push({ channels: wav.channels, start: message.start, lead: 0 }));
                    post({ type: "taken" });
                    return;
                }
                case "gap":
                    if (!stitcher) throw new Error("A gap can’t come first");
                    clean(stitcher.gap(message.seconds));
                    post({ type: "taken" });
                    return;
                case "end": {
                    if (!stitcher || !pipeline) throw new Error("No sound reached the noise remover");
                    clean(stitcher.finish());
                    const stats = pipeline.finish();
                    closePart();
                    const wav = new Blob([wavHeader(stats.channels, RNNOISE_RATE, stats.frames), ...parts], { type: "audio/wav" });
                    post({ type: "done", wav, stats: { ...stats, rate, stitch: stitcher.stats } });
                    return;
                }
            }
        },
    };
}
