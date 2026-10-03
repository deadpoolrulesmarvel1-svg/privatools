/**
 * Recognition windows for long audio.
 *
 * Whisper hears 30 seconds at a time. Rather than overlapping windows and
 * stitching their words back together, the audio is cut into windows of at
 * most 30 seconds at its quietest point near the end of each, which is
 * usually a pause between words, so no word is split and nothing is heard
 * twice. Each window is recognised on its own and its times are offset by
 * where it starts. A window of near-digital silence is skipped, which saves
 * the time and keeps Whisper from inventing words in silence.
 *
 * The cut needs only the next 30 seconds, so audio can arrive piece by piece
 * and be recognised as it comes (recognize.ts): memory stays the same for a
 * ten-minute clip and a three-hour film.
 */
import { WHISPER_SAMPLE_RATE } from "@/lib/whisper";

export const SAMPLE_RATE = WHISPER_SAMPLE_RATE;
export const WINDOW_SECONDS = 30;

/** 50 ms frames for measuring loudness. */
const FRAME = SAMPLE_RATE / 20;
const FRAMES_PER_SECOND = SAMPLE_RATE / FRAME;
/** How far back from a window's 30 seconds to look for a pause. */
const SEARCH_SECONDS = 8;
/** The shortest window left at the end of the audio. */
const MIN_TAIL_SECONDS = 2;
/** About -60 dBFS: quieter than any recording's speech, louder than digital silence. */
const SILENCE_RMS = 0.001;

/** A stretch of audio, in samples from the start; `silent` when nothing in it is louder than near-digital silence. */
export interface AudioWindow { start: number; end: number; silent: boolean }

/** Root-mean-square loudness of the 50 ms frame starting at sample `from`. */
function frameLevel(samples: Float32Array, from: number): number {
    const to = Math.min(samples.length, from + FRAME);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/** Whether nothing in `samples` is louder than near-digital silence. */
export function isSilent(samples: Float32Array): boolean {
    for (let from = 0; from < samples.length; from += FRAME) if (frameLevel(samples, from) >= SILENCE_RMS) return false;
    return true;
}

/**
 * Where the window starting at the beginning of `samples` should end, in
 * samples, or null when more audio is needed to decide. `final` says no more
 * audio follows: then the rest is one window if it fits, and a cut never
 * leaves less than two seconds behind it.
 */
export function windowEnd(samples: Float32Array, final: boolean): number | null {
    const length = samples.length;
    const frames = Math.ceil(length / FRAME);
    const most = WINDOW_SECONDS * FRAMES_PER_SECOND;
    if (!length) return null;
    if (frames <= most) return final ? length : null;
    const latest = final ? Math.min(most, frames - MIN_TAIL_SECONDS * FRAMES_PER_SECOND) : most;
    const earliest = Math.max(1, Math.min(latest, most - SEARCH_SECONDS * FRAMES_PER_SECOND));
    // Loudness over 250 ms around each frame, so a cut lands in a real pause rather than the gap inside a word.
    const levels = new Float32Array(latest + 3);
    for (let frame = Math.max(0, earliest - 2); frame <= Math.min(frames - 1, latest + 2); frame++) levels[frame] = frameLevel(samples, frame * FRAME);
    const quiet = (frame: number) => {
        let sum = 0;
        let n = 0;
        for (let i = Math.max(0, frame - 2); i <= Math.min(frames - 1, frame + 2); i++, n++) sum += levels[i];
        return sum / n;
    };
    // The quietest point, the latest of equals, so windows stay as long as they can.
    let cut = latest;
    let quietest = quiet(latest);
    for (let frame = latest - 1; frame >= earliest; frame--) {
        const level = quiet(frame);
        if (level < quietest) { cut = frame; quietest = level; }
    }
    return Math.min(length, cut * FRAME);
}

/** Windows covering all of 16 kHz mono `samples`, in order, each at most 30 seconds long. */
export function planWindows(samples: Float32Array): AudioWindow[] {
    const windows: AudioWindow[] = [];
    for (let start = 0; start < samples.length;) {
        const end = start + windowEnd(samples.subarray(start), true)!;
        windows.push({ start, end, silent: isSilent(samples.subarray(start, end)) });
        start = end;
    }
    return windows;
}
