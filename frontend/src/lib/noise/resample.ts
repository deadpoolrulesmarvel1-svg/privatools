/**
 * Changing a stream's sample rate, a block at a time.
 *
 * RNNoise hears 48 kHz only, so sound at any other rate is converted on the
 * way in. Each output sample is a windowed-sinc interpolation of the input
 * around its exact position: a Kaiser window (beta 8.6, about 85 dB of
 * stopband) over 32 zero crossings each side, cut off at 95% of the lower of
 * the two Nyquist frequencies, so converting down to 48 kHz also removes what
 * 48 kHz can't hold rather than folding it back as aliases. Positions are
 * exact fractions: for the usual rates every phase of the filter is
 * precomputed (160 phases for 44.1 kHz), and for odd rates 1024 phases are
 * interpolated. The filter is centred, so the output has no delay: output
 * sample n is input time n × from / to. Blocks join seamlessly, and the
 * output is the same however the input is cut into blocks.
 */

const ZERO_CROSSINGS = 32;
const ROLLOFF = 0.95;
const BETA = 8.6;
const MAX_EXACT_PHASES = 1024;

function gcd(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return a;
}

/** The modified Bessel function of the first kind, order 0, for the Kaiser window. */
function besselI0(x: number): number {
    let sum = 1;
    let term = 1;
    const quarter = (x * x) / 4;
    for (let k = 1; k < 64; k++) {
        term *= quarter / (k * k);
        sum += term;
        if (term < sum * 1e-17) break;
    }
    return sum;
}

export class Resampler {
    /** Output samples per `up`, input samples per `down`, reduced. */
    private readonly up: number;
    private readonly down: number;
    /** Half the filter's length, in input samples; each output sums 2 × half inputs. */
    private readonly half: number;
    /** Coefficients, phase by phase: phase q, tap k (input offset k − half + 1) at [q × 2half + k]. */
    private readonly table: Float32Array;
    private readonly phases: number;
    private readonly exact: boolean;
    /** Input not yet consumed, from absolute input index `base`. */
    private buffer: Float32Array;
    private length = 0;
    private base: number;
    /** The next output's position: input index `index` plus `phase` / up. */
    private index = 0;
    private phase = 0;
    private received = 0;
    private produced = 0;
    readonly identity: boolean;

    constructor(readonly from: number, readonly to: number) {
        if (!(from > 0 && to > 0 && Number.isInteger(from) && Number.isInteger(to))) throw new RangeError(`Sample rates must be whole numbers above 0, not ${from} and ${to}`);
        const divisor = gcd(from, to);
        this.up = to / divisor;
        this.down = from / divisor;
        this.identity = from === to;
        // Cut-off in cycles per input sample; the kernel widens as it narrows, keeping its zero crossings.
        const cutoff = 0.5 * Math.min(1, to / from) * ROLLOFF;
        this.half = Math.ceil(ZERO_CROSSINGS / (2 * cutoff));
        this.exact = this.up <= MAX_EXACT_PHASES;
        this.phases = this.exact ? this.up : MAX_EXACT_PHASES + 1;
        const taps = 2 * this.half;
        this.table = new Float32Array(this.phases * taps);
        const norm = besselI0(BETA);
        for (let q = 0; q < this.phases; q++) {
            const fraction = this.exact ? q / this.up : q / MAX_EXACT_PHASES;
            let sum = 0;
            for (let k = 0; k < taps; k++) {
                const t = fraction - (k - this.half + 1);
                const x = 2 * cutoff * t;
                const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
                const r = t / this.half;
                const window = Math.abs(r) >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / norm;
                const value = 2 * cutoff * sinc * window;
                this.table[q * taps + k] = value;
                sum += value;
            }
            // Each phase passes a constant at exactly 1.
            for (let k = 0; k < taps; k++) this.table[q * taps + k] /= sum;
        }
        // The stream is silent before its first sample.
        this.buffer = new Float32Array(Math.max(4096, taps * 4));
        this.length = this.half;
        this.base = -this.half;
    }

    /** How many output samples `inputs` input samples make in all: ceil(inputs × to / from). */
    outputLength(inputs: number): number {
        return Math.ceil((inputs * this.up) / this.down);
    }

    /** Convert the next block; returns the output samples now ready. */
    push(input: Float32Array): Float32Array {
        this.received += input.length;
        if (this.identity) {
            this.produced += input.length;
            return input.slice();
        }
        this.append(input);
        return this.drain(this.base + this.length);
    }

    /** The output still owed for the input given: the stream ends in silence. */
    flush(): Float32Array {
        if (this.identity) return new Float32Array(0);
        this.append(new Float32Array(this.half + 1));
        const out = this.drain(this.base + this.length, this.outputLength(this.received) - this.produced);
        return out;
    }

    private append(input: Float32Array) {
        if (this.length + input.length > this.buffer.length) {
            const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + input.length));
            grown.set(this.buffer.subarray(0, this.length));
            this.buffer = grown;
        }
        this.buffer.set(input, this.length);
        this.length += input.length;
    }

    /** Every output whose inputs, up to `available`, are all here; at most `limit` of them. */
    private drain(available: number, limit = Infinity): Float32Array {
        const taps = 2 * this.half;
        // Output n needs inputs index − half + 1 … index + half.
        let count = 0;
        {
            let index = this.index;
            let phase = this.phase;
            while (count < limit && index + this.half < available) {
                count++;
                phase += this.down;
                index += Math.floor(phase / this.up);
                phase %= this.up;
            }
        }
        const out = new Float32Array(count);
        const { buffer, table, up } = this;
        for (let n = 0; n < count; n++) {
            const start = this.index - this.half + 1 - this.base;
            let value = 0;
            if (this.exact) {
                const row = this.phase * taps;
                for (let k = 0; k < taps; k++) value += buffer[start + k] * table[row + k];
            } else {
                const position = (this.phase / up) * MAX_EXACT_PHASES;
                const q = Math.floor(position);
                const weight = position - q;
                const a = q * taps;
                const b = a + taps;
                for (let k = 0; k < taps; k++) value += buffer[start + k] * (table[a + k] + weight * (table[b + k] - table[a + k]));
            }
            out[n] = value;
            this.phase += this.down;
            this.index += Math.floor(this.phase / up);
            this.phase %= up;
        }
        this.produced += count;
        // Keep only what later outputs still need.
        const keepFrom = this.index - this.half + 1 - this.base;
        if (keepFrom > 0) {
            this.buffer.copyWithin(0, keepFrom, this.length);
            this.length -= keepFrom;
            this.base += keepFrom;
        }
        return out;
    }
}

/** Convert a whole signal at once. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
    const resampler = new Resampler(from, to);
    const head = resampler.push(input);
    const tail = resampler.flush();
    const out = new Float32Array(head.length + tail.length);
    out.set(head);
    out.set(tail, head.length);
    return out;
}
