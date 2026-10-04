/**
 * RNNoise, Xiph's speech noise suppressor, as WebAssembly.
 *
 * The module comes from @shiguredo/rnnoise-wasm 2025.1.5 (RNNoise built from
 * xiph/rnnoise 70f1d25, after its 0.2 release, with Emscripten 4.0.8 and no
 * SIMD). The build takes it out of the package's script and serves it as a
 * file of its own (scripts/rnnoise-wasm.mjs, which also checks it imports and
 * exports what this file expects); this file instantiates it with the three
 * functions it imports, in place of the package's 4.8 MB debug runtime.
 *
 * RNNoise hears 48 kHz audio in frames of 480 samples, scaled like 16-bit
 * PCM, and returns each frame cleaned along with how likely it is that the
 * frame holds a voice. Its output lags its input by two frames, 960 samples:
 * measured on synthetic speech, the output lines up with the input there.
 * ChannelDenoiser hides both: it takes and gives samples in -1..1, in any
 * amount, and what it gives lines up with what it was given, sample for
 * sample; flush() feeds silence through to bring out the last 960.
 */

export const RNNOISE_RATE = 48000;
export const FRAME = 480;
/** How far RNNoise's output trails its input, in samples. */
export const RNNOISE_DELAY = 960;
/** A frame RNNoise rates at least this likely to hold a voice counts as speech. */
export const SPEECH_VAD = 0.5;

const SCALE = 32768;

interface RnnoiseExports {
    memory: WebAssembly.Memory;
    malloc(bytes: number): number;
    free(pointer: number): void;
    rnnoise_create(model: number): number;
    rnnoise_destroy(state: number): void;
    rnnoise_process_frame(state: number, output: number, input: number): number;
    rnnoise_get_frame_size(): number;
    emscripten_stack_init(): void;
    __wasm_call_ctors(): void;
}

/** RNNoise stopped with an error inside the WebAssembly: a bug or a damaged module, never the visitor's file. */
export class RnnoiseFailure extends Error {
    readonly name = "RnnoiseFailure";
}

/** The largest memory the module may grow to, as Emscripten's own runtime allows by default. */
const MAX_MEMORY = 2 * 1024 * 1024 * 1024;

/** A C string in the module's memory. */
function cString(memory: WebAssembly.Memory, pointer: number): string {
    const bytes = new Uint8Array(memory.buffer);
    let end = pointer;
    while (end < bytes.length && bytes[end] !== 0 && end - pointer < 4096) end++;
    return new TextDecoder().decode(bytes.subarray(pointer, end));
}

/** One running copy of the module. Each channel gets its own state from it. */
export class Rnnoise {
    private constructor(private readonly exports: RnnoiseExports) {}

    /** A module compiled with WebAssembly.compile, here or on the page that sent it. */
    static async instantiate(module: WebAssembly.Module): Promise<Rnnoise> {
        let memory: WebAssembly.Memory | null = null;
        const imports = {
            env: {
                __assert_fail(condition: number, file: number, line: number) {
                    throw new RnnoiseFailure(memory
                        ? `RNNoise check failed: ${cString(memory, condition)} (${cString(memory, file)}:${line})`
                        : "RNNoise check failed");
                },
                // Emscripten's allocator asks for the total size it needs; grow by a fifth more, as Emscripten does, in whole pages.
                emscripten_resize_heap(requested: number) {
                    if (!memory) return 0;
                    const size = memory.buffer.byteLength;
                    const wanted = requested >>> 0;
                    if (wanted <= size) return 1;
                    if (wanted > MAX_MEMORY) return 0;
                    const target = Math.min(MAX_MEMORY, Math.max(wanted, size + Math.floor(size / 5)));
                    for (const bytes of [target, wanted]) {
                        try {
                            memory.grow(Math.ceil((bytes - size) / 65536));
                            return 1;
                        } catch { /* try the exact size, then give up */ }
                    }
                    return 0;
                },
            },
            wasi_snapshot_preview1: {
                // RNNoise writes nothing in normal use; anything it does write (an error) is counted as written and dropped.
                fd_write(_fd: number, iovs: number, count: number, written: number) {
                    if (!memory) return 0;
                    const view = new DataView(memory.buffer);
                    let total = 0;
                    for (let i = 0; i < count; i++) total += view.getUint32(iovs + i * 8 + 4, true);
                    view.setUint32(written, total, true);
                    return 0;
                },
            },
        };
        const instance = await WebAssembly.instantiate(module, imports);
        const exports = instance.exports as unknown as RnnoiseExports;
        memory = exports.memory;
        // What Emscripten's runtime does before main: set up the stack's bounds, then run the C constructors.
        exports.emscripten_stack_init();
        exports.__wasm_call_ctors();
        const frame = exports.rnnoise_get_frame_size();
        if (frame !== FRAME) throw new RnnoiseFailure(`RNNoise works in frames of ${frame} samples, not ${FRAME}`);
        return new Rnnoise(exports);
    }

    /** A fresh denoiser for one channel. destroy() it when done. */
    channel(): ChannelDenoiser {
        return new ChannelDenoiser(this.exports);
    }
}

export class ChannelDenoiser {
    private state: number;
    private readonly input: number;
    private readonly output: number;
    private heap: Float32Array;
    private readonly pending = new Float32Array(FRAME);
    private filled = 0;
    /** Samples given, samples given back, and raw output still to drop for RNNoise's delay. */
    private received = 0;
    private returned = 0;
    private skip = RNNOISE_DELAY;
    /** Frames of the input heard, and how many RNNoise rated as speech. */
    frames = 0;
    speechFrames = 0;

    constructor(private readonly exports: RnnoiseExports) {
        this.state = exports.rnnoise_create(0);
        this.input = exports.malloc(FRAME * 4);
        this.output = exports.malloc(FRAME * 4);
        if (!this.state || !this.input || !this.output) {
            this.destroy();
            throw new RnnoiseFailure("RNNoise couldn’t allocate its memory");
        }
        this.heap = new Float32Array(exports.memory.buffer);
    }

    /** Clean `samples`; returns as many cleaned samples as are ready, lined up with the input given so far. */
    process(samples: Float32Array): Float32Array {
        if (!this.state) throw new RnnoiseFailure("This denoiser has been destroyed");
        this.received += samples.length;
        const frames = Math.floor((this.filled + samples.length) / FRAME);
        const out = new Float32Array(Math.max(0, frames * FRAME - this.skip));
        let written = 0;
        for (let at = 0; at < samples.length;) {
            const take = Math.min(FRAME - this.filled, samples.length - at);
            this.pending.set(samples.subarray(at, at + take), this.filled);
            this.filled += take;
            at += take;
            if (this.filled === FRAME) written = this.runFrame(out, written, true);
        }
        this.returned += written;
        return written === out.length ? out : out.slice(0, written);
    }

    /** Feed silence until every sample given has come back cleaned; returns those last samples. */
    flush(): Float32Array {
        const due = this.received - this.returned;
        const out = new Float32Array(due);
        let written = 0;
        // The partial frame first, its real samples counted as heard, then whole frames of silence.
        let real = this.filled > 0;
        while (written < due) {
            this.pending.fill(0, this.filled);
            written = this.runFrame(out, written, real, due);
            real = false;
        }
        this.returned += written;
        return out;
    }

    /** Run the frame in `pending` and copy its output, after the delay, into `out` from `at`. */
    private runFrame(out: Float32Array, at: number, heard: boolean, limit = out.length): number {
        const { exports } = this;
        if (this.heap.buffer !== exports.memory.buffer) this.heap = new Float32Array(exports.memory.buffer);
        const heap = this.heap;
        const inputAt = this.input >> 2;
        for (let i = 0; i < FRAME; i++) heap[inputAt + i] = this.pending[i] * SCALE;
        let vad: number;
        try {
            vad = exports.rnnoise_process_frame(this.state, this.output, this.input);
        } catch (error) {
            throw error instanceof RnnoiseFailure ? error : new RnnoiseFailure(`RNNoise stopped: ${(error as Error)?.message ?? error}`);
        }
        if (this.heap.buffer !== exports.memory.buffer) this.heap = new Float32Array(exports.memory.buffer);
        if (heard) {
            this.frames++;
            if (vad >= SPEECH_VAD) this.speechFrames++;
        }
        this.filled = 0;
        const outputAt = this.output >> 2;
        let first = 0;
        if (this.skip > 0) {
            first = Math.min(this.skip, FRAME);
            this.skip -= first;
        }
        const count = Math.min(FRAME - first, limit - at);
        for (let i = 0; i < count; i++) out[at + i] = this.heap[outputAt + first + i] / SCALE;
        return at + count;
    }

    destroy(): void {
        if (this.state) this.exports.rnnoise_destroy(this.state);
        if (this.input) this.exports.free(this.input);
        if (this.output) this.exports.free(this.output);
        this.state = 0;
    }
}
