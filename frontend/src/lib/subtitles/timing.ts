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
 * The same measure tells recognize.ts when Whisper stopped writing before the
 * speech did (unheardSpeech).
 */
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
