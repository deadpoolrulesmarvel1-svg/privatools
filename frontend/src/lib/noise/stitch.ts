/**
 * Joining sound that was decoded a piece at a time.
 *
 * A long file's sound is read about a minute at a time (lib/subtitles/media),
 * and each piece is decoded on its own by the browser. A piece decoded on its
 * own starts with a decoder that knows nothing of the sound before it: its
 * first few frames come out wrong (MP3's bit reservoir, AAC and Vorbis's
 * overlapping blocks, Opus's state), its last frame is missing what the next
 * one would add, and the decoder may drop or add samples at its start (Opus's
 * pre-skip, priming). Laid end to end, the pieces would click at every join
 * and drift out of time.
 *
 * So every piece after the first is decoded with a lead: about a second of
 * the sound before it, decoded again. Here the lead is laid against the end
 * of the piece before, which holds the same sound decoded properly, to find
 * how many samples the decoder shifted the piece by: the offset, within a
 * tenth of a second either way, at which the two agree best, over a tenth of
 * a second of sound. The join is made in the middle of the lead, half a
 * second from either piece's edge, with a 5 ms crossfade. Where there is
 * nothing to match (silence) or nothing matches, the piece goes where its
 * timestamps say, shifted as the last matched piece was: a decoder shifts
 * every piece alike.
 *
 * The output timeline starts where the file's presentation starts: the first
 * piece's start can be before zero (an MP4's encoder priming, which its edit
 * list skips) or after it (an edit that delays the sound).
 */

export interface DecodedPiece {
    /** One array per channel, at the stitcher's rate. */
    channels: Float32Array[];
    /** Where this piece's own sound starts on the file's timeline, in seconds. */
    start: number;
    /** Seconds of the sound before `start` decoded with it, for the decoder to settle; 0 when it has none. */
    lead: number;
}

export interface StitchStats {
    joins: number;
    /** Joins placed by matching the lead against the piece before. */
    matched: number;
    /** Joins over silence, placed by the timestamps. */
    silent: number;
    /** Joins where nothing matched, placed by the timestamps. */
    unmatched: number;
    /** The largest offset found, in samples. */
    largestOffset: number;
}

const WINDOW_SECONDS = 0.1;
const SEARCH_SECONDS = 0.1;
const CROSSFADE_SECONDS = 0.005;
/** How much of each piece's end is held back for the next piece's lead to be laid against. */
const HOLD_SECONDS = 2.5;
/** The longest silence put before the sound when the file says it starts late. */
const MAX_DELAY_SECONDS = 60;
/** Below this mean square the matching window counts as silence. */
const SILENCE = 1e-9;
/** A match is accepted when the two windows differ by less than this share of their energy. */
const MATCHED = 0.05;

export class Stitcher {
    private tail: Float32Array[] = [];
    /** Output index of tail[0]: how many samples have been given out. */
    private written = 0;
    private started = false;
    /** The offset found at the previous join, preferred when several fit as well (periodic sound). */
    private previousOffset = 0;
    private readonly window: number;
    private readonly search: number;
    private readonly crossfade: number;
    private readonly hold: number;
    readonly stats: StitchStats = { joins: 0, matched: 0, silent: 0, unmatched: 0, largestOffset: 0 };

    constructor(readonly rate: number, readonly channelCount: number) {
        this.window = Math.max(16, Math.round(WINDOW_SECONDS * rate));
        this.search = Math.max(8, Math.round(SEARCH_SECONDS * rate));
        this.crossfade = Math.max(8, Math.round(CROSSFADE_SECONDS * rate));
        this.hold = Math.round(HOLD_SECONDS * rate);
    }

    /** Samples given out so far. */
    get length(): number {
        return this.written;
    }

    /** Add a decoded piece; returns the samples now final, in order, or null when none are. */
    push(piece: DecodedPiece): Float32Array[] | null {
        const channels = this.fit(piece.channels);
        const length = channels[0]?.length ?? 0;
        if (!this.started) {
            this.started = true;
            // The first piece is laid where the file's timeline puts it.
            const at = Math.round((piece.start - piece.lead) * this.rate);
            const delay = Math.min(Math.max(0, at), Math.round(MAX_DELAY_SECONDS * this.rate));
            const drop = Math.min(length, Math.max(0, -at));
            this.tail = channels.map(channel => {
                const placed = new Float32Array(delay + length - drop);
                placed.set(channel.subarray(drop), delay);
                return placed;
            });
            return this.release();
        }
        if (piece.lead <= 0) {
            // No lead: a piece that follows on exactly (a whole-file block, a WAV piece, a stretch of silence).
            this.tail = this.tail.map((held, c) => concat(held, channels[c]));
            return this.release();
        }
        this.join(channels, piece);
        return this.release();
    }

    /** Silence for a stretch the browser couldn't decode, laid after what came before. */
    gap(seconds: number): Float32Array[] | null {
        const count = Math.max(0, Math.round(seconds * this.rate));
        return this.push({ channels: Array.from({ length: this.channelCount }, () => new Float32Array(count)), start: 0, lead: 0 });
    }

    /** Everything still held back. */
    finish(): Float32Array[] {
        const out = this.tail;
        this.written += out[0]?.length ?? 0;
        this.tail = Array.from({ length: this.channelCount }, () => new Float32Array(0));
        return out.length ? out : Array.from({ length: this.channelCount }, () => new Float32Array(0));
    }

    /** Give out all but the last `hold` samples of the tail. */
    private release(): Float32Array[] | null {
        const length = this.tail[0]?.length ?? 0;
        const ready = length - this.hold;
        if (ready <= 0) return null;
        const out = this.tail.map(channel => channel.slice(0, ready));
        this.tail = this.tail.map(channel => channel.slice(ready));
        this.written += ready;
        return out;
    }

    /** A piece's channels as this stitcher's count: extra channels mixed in, a missing one copied. */
    private fit(channels: Float32Array[]): Float32Array[] {
        if (channels.length === this.channelCount) return channels;
        if (this.channelCount === 1) {
            const mono = new Float32Array(channels[0].length);
            for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
            return [mono];
        }
        return Array.from({ length: this.channelCount }, (_, c) => channels[Math.min(c, channels.length - 1)]);
    }

    /** Lay a piece with a lead over the end of the tail. */
    private join(channels: Float32Array[], piece: DecodedPiece) {
        this.stats.joins++;
        const length = channels[0].length;
        const tailLength = this.tail[0].length;
        // Output index of the piece's first sample, by its timestamps.
        const nominal = Math.round((piece.start - piece.lead) * this.rate);
        const half = this.window >> 1;
        // The join, in the middle of the lead, kept where the tail has a window and a crossfade around it.
        const earliest = this.written + half + this.crossfade;
        const latest = this.written + tailLength - this.window + half - this.crossfade;
        let joinAt = Math.round((piece.start - piece.lead / 2) * this.rate);
        joinAt = Math.min(Math.max(joinAt, earliest), latest);
        // The piece's samples under the window, at the nominal offset; the search needs room either side.
        const pieceAt = joinAt - half - nominal;
        // A decoder shifts every piece alike, so a join with nothing to match takes the last offset found.
        let offset = this.previousOffset;
        if (latest >= earliest && pieceAt - this.search >= 0 && pieceAt + this.window + this.search <= length) {
            const found = this.match(channels, joinAt - half - this.written, pieceAt);
            if (found.kind === "silent") this.stats.silent++;
            else if (found.kind === "unmatched") this.stats.unmatched++;
            else {
                this.stats.matched++;
                offset = found.offset;
                this.previousOffset = offset;
                this.stats.largestOffset = Math.max(this.stats.largestOffset, Math.abs(offset));
            }
        } else {
            this.stats.unmatched++;
            // Too little overlap to match: join where the piece's own sound starts.
            joinAt = Math.min(Math.max(Math.round(piece.start * this.rate), this.written + this.crossfade), this.written + tailLength);
        }
        // Piece sample j belongs at output index nominal + offset + j.
        const shift = nominal + offset;
        const fadeStart = Math.max(this.written, joinAt - (this.crossfade >> 1));
        const fadeEnd = Math.min(this.written + tailLength, fadeStart + this.crossfade);
        const fade = fadeEnd - fadeStart;
        const fromPiece = Math.max(0, fadeStart - shift);
        this.tail = this.tail.map((held, c) => {
            const source = channels[c];
            const keep = fadeStart - this.written;
            const after = Math.max(0, length - fromPiece);
            const joined = new Float32Array(keep + after);
            joined.set(held.subarray(0, keep));
            for (let i = 0; i < after; i++) {
                const value = source[fromPiece + i];
                if (i < fade) {
                    const weight = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / fade);
                    joined[keep + i] = held[keep + i] * (1 - weight) + value * weight;
                } else {
                    joined[keep + i] = value;
                }
            }
            return joined;
        });
    }

    /**
     * The offset at which the piece agrees best with the tail: tail samples
     * from `tailAt` against piece samples from `pieceAt` − offset (a piece
     * shifted later by the decoder needs a positive offset), offsets up to
     * the search range either way, over one window of the channels' mix.
     */
    private match(channels: Float32Array[], tailAt: number, pieceAt: number): { kind: "matched"; offset: number } | { kind: "silent" } | { kind: "unmatched" } {
        const width = this.window;
        const reference = new Float32Array(width);
        for (const held of this.tail) for (let i = 0; i < width; i++) reference[i] += held[tailAt + i];
        let referenceEnergy = 0;
        for (let i = 0; i < width; i++) referenceEnergy += reference[i] * reference[i];
        if (referenceEnergy / width < SILENCE * this.tail.length * this.tail.length) return { kind: "silent" };
        const span = width + 2 * this.search;
        const mixed = new Float32Array(span);
        for (const channel of channels) for (let i = 0; i < span; i++) mixed[i] += channel[pieceAt - this.search + i];
        // Running energy of the candidate window as it slides.
        let candidateEnergy = 0;
        for (let i = 0; i < width; i++) candidateEnergy += mixed[i] * mixed[i];
        let best = Infinity;
        const scores = new Float64Array(2 * this.search + 1);
        for (let k = 0; k <= 2 * this.search; k++) {
            if (k > 0) {
                const out = mixed[k - 1];
                const into = mixed[k + width - 1];
                candidateEnergy += into * into - out * out;
            }
            let cross = 0;
            for (let i = 0; i < width; i++) cross += reference[i] * mixed[k + i];
            const total = referenceEnergy + Math.max(0, candidateEnergy);
            const score = (referenceEnergy + Math.max(0, candidateEnergy) - 2 * cross) / total;
            scores[k] = score;
            if (score < best) best = score;
        }
        if (!(best < MATCHED)) return { kind: "unmatched" };
        // Of the offsets that fit as well as the best (a steady tone whose period is whole samples fits at every
        // period), the one nearest the last. The same sound decoded twice fits exactly; a period off fits worse.
        const tie = best * 1.2 + 1e-9;
        let chosen = 0;
        let distance = Infinity;
        for (let k = 0; k <= 2 * this.search; k++) {
            if (scores[k] > tie) continue;
            // Window k starts at piece sample pieceAt − search + k, which is pieceAt − offset.
            const offset = this.search - k;
            const away = Math.abs(offset - this.previousOffset);
            if (away < distance) { distance = away; chosen = offset; }
        }
        return { kind: "matched", offset: chosen };
    }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
