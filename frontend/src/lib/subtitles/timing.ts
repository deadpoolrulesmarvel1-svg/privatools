/**
 * Caption timing fitted to the speech.
 *
 * Whisper times each segment it writes, but coarsely. On the synthetic test
 * clips Whisper Base started each of three sentences 1.2 to 1.3 seconds early,
 * in the silence before the words, and Tiny ended sentences up to 2.5 seconds
 * late, inside the next one. Two corrections follow, both judged against the
 * quietest tenth of the window:
 *  - where one segment ends as the next begins, that boundary moves into the
 *    nearest pause within a second and a half (snapToPauses);
 *  - each segment is then drawn in to where the sound inside it actually is,
 *    from a tenth of a second before the first word to a quarter of a second
 *    after the last (tightenToSpeech), only ever shortened.
 * Where there is no clear difference between speech and silence (music, or
 * speech from end to end), Whisper's own times are kept.
 *
 * After both, a run of segments still far longer than its text takes to
 * say, which Whisper writes when music or noise comes before or after the
 * words, is given the time its text takes, from its end that borders a pause
 * (fitToText).
 *
 * The same measure tells recognize.ts when Whisper stopped writing before the
 * speech did (unheardSpeech).
 */
import { speechUnits } from "./quality";
import { SAMPLE_RATE } from "./windows";

/** 20 ms frames: Whisper's own timestamp step. */
const FRAME = SAMPLE_RATE / 50;
const FRAMES_PER_SECOND = SAMPLE_RATE / FRAME;
/** Seconds kept before the first word and after the last, so soft consonants and the reader are not cut short. */
const LEAD = 0.1;
const HANG = 0.25;
/** Speech must stand at least this far above the floor for the segment to be redrawn. */
const CONTRAST = 4;
const FLOOR_MINIMUM = 0.002;

function level(samples: Float32Array, frame: number): number {
    const from = frame * FRAME;
    const to = Math.min(samples.length, from + FRAME);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

/** The level of the quietest tenth of a window: its silence, or its background noise. */
export function noiseFloor(window: Float32Array): number {
    const levels: number[] = [];
    for (let frame = 0; frame * FRAME < window.length; frame++) levels.push(level(window, frame));
    return percentile(levels, 0.1);
}

/** Each 20 ms frame's level, and the level above which a frame is speech; null when nothing stands clearly above the floor. */
function voice(window: Float32Array, floor: number): { levels: number[]; threshold: number } | null {
    const frames = Math.ceil(window.length / FRAME);
    const levels = Array.from({ length: frames }, (_, frame) => level(window, frame));
    const peak = percentile(levels, 0.95);
    if (peak < Math.max(floor * CONTRAST, FLOOR_MINIMUM)) return null;
    return { levels, threshold: floor + (peak - floor) * 0.15 };
}

function quietStretches({ levels, threshold }: { levels: number[]; threshold: number }, minimumSeconds: number): [number, number][] {
    const frames = levels.length;
    const found: [number, number][] = [];
    let start = -1;
    for (let frame = 0; frame <= frames; frame++) {
        const quiet = frame < frames && levels[frame] <= threshold;
        if (quiet && start < 0) start = frame;
        if (!quiet && start >= 0) {
            if ((frame - start) / FRAMES_PER_SECOND >= minimumSeconds) found.push([start / FRAMES_PER_SECOND, frame / FRAMES_PER_SECOND]);
            start = -1;
        }
    }
    return found;
}

/**
 * Pauses of at least a quarter of a second in a window, as [start, end] in
 * seconds: stretches no louder than the floor plus a little of the way to the
 * speech. None when there is no clear difference between the two.
 */
export function pausesIn(window: Float32Array, floor: number, minimumSeconds = 0.25): [number, number][] {
    const levels = voice(window, floor);
    return levels ? quietStretches(levels, minimumSeconds) : [];
}

/**
 * The stretches of speech in a window, between its pauses, as [start, end] in
 * seconds; null when there is no clear difference between speech and silence
 * (music, steady noise, or speech from end to end).
 */
export function speechRuns(window: Float32Array, floor: number): [number, number][] | null {
    const levels = voice(window, floor);
    if (!levels) return null;
    const seconds = window.length / SAMPLE_RATE;
    const runs: [number, number][] = [];
    let at = 0;
    for (const [from, to] of quietStretches(levels, 0.25)) {
        if (from > at) runs.push([at, from]);
        at = to;
    }
    if (at < seconds) runs.push([at, seconds]);
    return runs;
}

/** Whole stretches of speech after Whisper's last segment, this long in all, mean it stopped writing early. */
const UNHEARD_SECONDS = 1;

/**
 * Whisper sometimes ends its output before the speech does: on one synthetic
 * clip Whisper Tiny wrote the first of three sentences, timed it to run into
 * the second, and wrote nothing more. Given the last segment Whisper wrote in
 * a window, as [start, end] in seconds, this says where to ask it again: null
 * unless whole stretches of clear speech, a second or more in all, follow the
 * segment. Then it is the start of the stretch the segment ends in, when the
 * segment also holds speech before that stretch (so its words may not be in
 * the segment's text), or else the start of the first stretch after it.
 */
export function unheardSpeech(window: Float32Array, start: number, end: number, floor: number): number | null {
    const runs = speechRuns(window, floor);
    if (!runs) return null;
    const after = runs.filter(([from]) => from >= end);
    if (after.reduce((sum, [from, to]) => sum + to - from, 0) < UNHEARD_SECONDS) return null;
    const within = runs.find(([from, to]) => from < end && to > end);
    const before = within && runs.some(([from, to]) => to <= within[0] && Math.min(to, end) - Math.max(from, start) >= 0.3);
    return before ? within[0] - LEAD : Math.max(end, after[0][0] - LEAD);
}

/**
 * Where Whisper ends one segment and starts the next at the same moment, that
 * moment can fall inside a word of the next sentence. Such a boundary moves
 * into the nearest pause, if one is within `maxShift` seconds and leaves both
 * segments some time of their own: the first then ends a quarter second into
 * the pause and the second starts a tenth before the voice. Segments already
 * apart are left as they are. Times are seconds within one window.
 */
export function snapToPauses(segments: { start: number; end: number }[], pauses: [number, number][], maxShift = 1.5): void {
    for (let i = 0; i + 1 < segments.length; i++) {
        const first = segments[i];
        const second = segments[i + 1];
        if (second.start - first.end > 0.3) continue;
        const boundary = (first.end + second.start) / 2;
        let best: [number, number] | null = null;
        let distance = Number.POSITIVE_INFINITY;
        for (const pause of pauses) {
            const [from, to] = pause;
            if (from <= first.start + 0.3 || to >= second.end - 0.3) continue;
            const away = boundary < from ? from - boundary : boundary > to ? boundary - to : 0;
            if (away < distance || (away === distance && best && to - from > best[1] - best[0])) {
                best = pause;
                distance = away;
            }
        }
        if (!best || distance > maxShift) continue;
        first.end = Math.min(best[1], best[0] + HANG);
        second.start = Math.max(first.end, best[1] - LEAD);
    }
}

/**
 * The segment [start, end], in seconds within `window`, drawn in to the sound
 * inside it, or null to keep it as it is.
 */
export function tightenToSpeech(window: Float32Array, start: number, end: number, floor: number): [number, number] | null {
    const first = Math.max(0, Math.floor(start * FRAMES_PER_SECOND));
    const last = Math.min(Math.ceil(end * FRAMES_PER_SECOND), Math.ceil(window.length / FRAME));
    if (last - first < 3) return null;
    const levels: number[] = [];
    for (let frame = first; frame < last; frame++) levels.push(level(window, frame));
    const peak = percentile(levels, 0.95);
    if (peak < Math.max(floor * CONTRAST, FLOOR_MINIMUM)) return null;
    const threshold = floor + (peak - floor) * 0.15;
    const on = levels.findIndex(value => value > threshold);
    let off = levels.length - 1;
    while (off > on && levels[off] <= threshold) off--;
    const tightStart = Math.max(start, (first + on) / FRAMES_PER_SECOND - LEAD);
    const tightEnd = Math.min(end, (first + off + 1) / FRAMES_PER_SECOND + HANG);
    if (tightEnd <= tightStart) return null;
    return [Math.round(tightStart * 1000) / 1000, Math.round(tightEnd * 1000) / 1000];
}

/** A run of segments is far too long for its text past this: slower than six letters a second, with two seconds to spare. */
const SLOW_RATE = 6;
const SLOW_SPARE = 2;
/** The time such a run is given: its text at twelve letters a second, with 0.6 s to spare. */
const USUAL_RATE = 12;
const USUAL_SPARE = 0.6;
/** How much of the sound either side of a run is looked at to tell whether a pause borders it. */
const BORDER = 0.3;
/** The loudest stretch must be this much louder than the rest of the run to be taken for the voice. */
const LOUDER = 1.2;

/**
 * Whisper often starts a segment where music or noise before the words
 * begins, or ends one where it goes on after them: on a synthetic test clip
 * with music between its sentences, Whisper Tiny started the sentences after
 * music 8 to 15 seconds early, and Whisper Base ran its first sentence on into
 * the music after it. After tightening, the end of a segment that borders a
 * pause is where the voice starts or stops; the end that runs into music does
 * not border one.
 *
 * So a run of segments, each starting within 0.3 s of the last one's end,
 * that lasts far longer than its text takes to say (two seconds longer than
 * at six letters a second) is given the time its text takes at twelve letters
 * a second, with 0.6 s to spare, from the end of it that borders a pause.
 * When neither end does, it gets the loudest stretch of that length inside it,
 * since a voice is mixed above the sound around it, if that stretch is
 * clearly louder than the rest; otherwise, or when both ends border a pause,
 * or nothing in the window tells sound from quiet, Whisper's times stand. The
 * run's segments share its time by the length of their text. Times are
 * seconds within `window`, changed in place.
 */
export function fitToText(window: Float32Array, segments: { start: number; end: number; text: string }[]): void {
    let sound: { levels: number[]; threshold: number } | null | undefined;
    let sums: Float64Array | null = null;
    for (let first = 0; first < segments.length;) {
        let last = first;
        while (last + 1 < segments.length && segments[last + 1].start - segments[last].end <= 0.3) last++;
        const group = segments.slice(first, last + 1);
        first = last + 1;
        const units = group.map(segment => speechUnits(segment.text));
        const total = units.reduce((sum, value) => sum + value, 0) + group.length - 1;
        const start = group[0].start;
        const end = group[group.length - 1].end;
        if (!total || end - start <= total / SLOW_RATE + SLOW_SPARE) continue;
        if (sound === undefined) sound = voice(window, noiseFloor(window));
        if (!sound) continue;
        const { levels, threshold } = sound;
        const frame = (seconds: number) => Math.max(0, Math.min(levels.length, Math.round(seconds * FRAMES_PER_SECOND)));
        /** Whether most of [from, to) is quiet; false where any of it lies outside the window, which can't tell. */
        const quiet = (from: number, to: number) => {
            if (from < 0 || to * FRAMES_PER_SECOND > levels.length) return false;
            const a = frame(from);
            const b = frame(to);
            let count = 0;
            for (let f = a; f < b; f++) if (levels[f] <= threshold) count++;
            return b > a && count >= (b - a) * 0.8;
        };
        const length = Math.min(end - start, total / USUAL_RATE + USUAL_SPARE);
        const startHeld = quiet(start - BORDER, start);
        const endHeld = quiet(end, end + BORDER);
        let at: number;
        if (startHeld && endHeld) continue;
        if (startHeld) at = start;
        else if (endHeld) at = end - length;
        else {
            if (!sums) {
                sums = new Float64Array(levels.length + 1);
                for (let f = 0; f < levels.length; f++) sums[f + 1] = sums[f] + levels[f];
            }
            const prefix = sums;
            const mean = (from: number, to: number) => {
                const a = frame(from);
                const b = frame(to);
                return b > a ? (prefix[b] - prefix[a]) / (b - a) : 0;
            };
            at = start;
            let loudest = mean(start, start + length);
            for (let from = start; from + length <= end; from += 1 / FRAMES_PER_SECOND) {
                const value = mean(from, from + length);
                if (value > loudest) { loudest = value; at = from; }
            }
            const all = frame(end) - frame(start);
            const inside = frame(at + length) - frame(at);
            const rest = all > inside ? (prefix[frame(end)] - prefix[frame(start)] - (prefix[frame(at + length)] - prefix[frame(at)])) / (all - inside) : 0;
            if (loudest < rest * LOUDER) continue;
        }
        const stop = at + length >= end - 1e-6 ? end : at + length;
        let cursor = at;
        group.forEach((segment, i) => {
            segment.start = cursor;
            cursor = i === group.length - 1 ? stop : Math.min(stop, cursor + length * (units[i] + 1) / total);
            segment.end = cursor;
        });
    }
}

/**
 * Whether [start, end] holds no voice, in a window where voice stands clear
 * of the quiet: every 20 ms frame of it is quiet. False where the window has
 * no clear quiet to judge by (music or noise throughout).
 */
export function quietThroughout(window: Float32Array, start: number, end: number, floor: number): boolean {
    const sound = voice(window, floor);
    if (!sound) return false;
    const first = Math.max(0, Math.floor(start * FRAMES_PER_SECOND));
    const last = Math.min(sound.levels.length, Math.ceil(end * FRAMES_PER_SECOND));
    for (let frame = first; frame < last; frame++) if (sound.levels[frame] > sound.threshold) return false;
    return true;
}

/** Where a sentence ends inside a text and another begins: after its closing mark, and any quote or bracket. */
const SENTENCE_BREAK = /(?<=[.!?…؟۔।॥]["'”’»)\]]*)\s+(?=\S)|(?<=[。！？]["'”’»」』)）]*)(?=\S)/u;
/** A pause between sentences: at least this long. */
const SENTENCE_PAUSE = 0.4;
/** A sentence of three words or more, or six characters of Chinese or Japanese, written without spaces. */
const longEnough = (sentence: string) => sentence.split(/\s+/).length >= 3 || (/[\u3040-\u30ff\u3400-\u9fff]/u.test(sentence) && Array.from(sentence).length >= 6);

/**
 * Whisper sometimes writes two or more sentences as one segment, and a
 * caption holding both shows the second as early as the first: 2.8 s early
 * once on the 18-minute test talk. A segment whose sentences are each three
 * words or more (six characters of Chinese or Japanese), with as many clear
 * pauses inside it (0.4 s or more) as there are breaks between the
 * sentences, is cut at those pauses: each sentence
 * ends a quarter second into the pause after it and starts a tenth of a
 * second before the voice after the pause before it. Any other segment is
 * left whole. Times are seconds within `window`.
 */
export function splitAtPauses<T extends { start: number; end: number; text: string }>(window: Float32Array, segments: readonly T[], floor: number): T[] {
    const pauses = pausesIn(window, floor, SENTENCE_PAUSE);
    return segments.flatMap(segment => {
        const sentences = segment.text.split(SENTENCE_BREAK).map(part => part.trim()).filter(Boolean);
        if (sentences.length < 2 || !sentences.every(longEnough)) return [segment];
        const inside = pauses.filter(([from, to]) => from > segment.start + 0.3 && to < segment.end - 0.3);
        if (inside.length !== sentences.length - 1) return [segment];
        return sentences.map((text, i) => ({
            ...segment,
            text,
            start: i === 0 ? segment.start : inside[i - 1][1] - LEAD,
            end: i === sentences.length - 1 ? segment.end : Math.min(inside[i][1], inside[i][0] + HANG),
        }));
    });
}
