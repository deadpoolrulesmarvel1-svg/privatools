/**
 * Speech recognition over long audio, one window at a time (windows.ts), as
 * the audio arrives.
 *
 * The recognizer is Whisper (lib/whisper.ts), in a worker, or on the page
 * where a worker cannot run it. Between windows the page gets a turn to draw
 * the progress, which counts seconds of audio actually recognised, and to take
 * a click on Stop, which ends the run after the window in hand and keeps what
 * is done.
 *
 * When Whisper stops writing before the speech in a window ends, it is asked
 * again from the speech it left out, at most twice a window (timing.ts says
 * where), and words the second pass repeats are kept once.
 */
import type { SpeechSegment } from "@/lib/speechTranscript";
import { noiseFloor, pausesIn, snapToPauses, tightenToSpeech, unheardSpeech } from "./timing";
import { isSilent, SAMPLE_RATE, windowEnd } from "./windows";

/** A timed piece of Whisper's output, in seconds from the start of the audio it was given. */
export interface WhisperChunk { timestamp: [number | null, number | null]; text: string }

/** Whisper on a window of audio; `onPosition`, where the recognizer can tell, hears how far into it Whisper has written. */
export type Recognizer = (audio: Float32Array, options: Record<string, unknown>, onPosition?: (seconds: number) => void) => Promise<{ text?: string; chunks?: WhisperChunk[] }>;

/** A stretch of 16 kHz mono sound and where it starts, in seconds. One the browser could not decode has no samples and says how long it was. */
export type AudioChunk = { start: number; samples: Float32Array } | { start: number; unreadableSeconds: number };

export interface RecognizeOptions {
    /** Whisper's code for the spoken language: "en", "de", "haw". */
    language: string;
    /** How long the audio is, in seconds, when the chunks are still to come. */
    totalSeconds?: number;
    /** Seconds of audio recognised so far, and in all. */
    onProgress?: (doneSeconds: number, totalSeconds: number) => void;
    /** Stop after the window in hand. */
    signal?: AbortSignal;
    /** Waits for the page's next turn. */
    yieldToPage?: () => Promise<void>;
}

export interface RecognizedSpeech {
    segments: SpeechSegment[];
    doneSeconds: number;
    totalSeconds: number;
    /** Stopped before the end, by request. */
    stopped: boolean;
    /** Stretches the browser could not decode, in seconds: no words come from them. */
    unreadable: { start: number; end: number }[];
}

/** A task boundary rather than a microtask: the page draws and handles input before the next window. */
export function nextTask(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** How many more times Whisper is asked for speech it left out of one window. */
const RETRIES = 2;

type WordSegmenter = new (locale?: string, options?: { granularity: "word" }) => { segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> };
const Segmenter = (Intl as unknown as { Segmenter?: WordSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "word" }) : null;

/** The words of a text, compared without case or punctuation, with where each starts. */
function wordsOf(text: string): { word: string; index: number }[] {
    const words = segmenter
        ? [...segmenter.segment(text)].filter(part => part.isWordLike).map(part => ({ word: part.segment, index: part.index }))
        : [...text.matchAll(/\S+/g)].map(match => ({ word: match[0], index: match.index ?? 0 }));
    return words
        .map(({ word, index }) => ({ word: word.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), index }))
        .filter(({ word }) => word);
}

/**
 * `earlier` without the words at its end that `later` starts with: the same
 * speech, written by two passes over it. At least `fewest` words must match.
 */
export function withoutRepeat(earlier: string, later: string, fewest: number): string {
    const first = wordsOf(earlier);
    const second = wordsOf(later);
    for (let count = Math.min(first.length, second.length); count >= Math.max(1, fewest); count--) {
        const tail = first.slice(first.length - count);
        if (tail.every((word, i) => word.word === second[i].word)) return earlier.slice(0, tail[0].index).replace(/[\s,;:–—-]+$/u, "");
    }
    return earlier;
}

async function* single(samples: Float32Array): AsyncGenerator<AudioChunk> {
    yield { start: 0, samples };
}

/**
 * Recognise 16 kHz mono audio, whole or as chunks in order, window by window,
 * with times from the start of the audio.
 */
export async function recognizeSpeech(audio: Float32Array | AsyncIterable<AudioChunk>, recognize: Recognizer, options: RecognizeOptions): Promise<RecognizedSpeech> {
    const { language, onProgress, signal, yieldToPage = nextTask } = options;
    const chunks = audio instanceof Float32Array ? single(audio) : audio;
    let totalSeconds = audio instanceof Float32Array ? audio.length / SAMPLE_RATE : options.totalSeconds ?? 0;
    const segments: SpeechSegment[] = [];
    const unreadable: { start: number; end: number }[] = [];
    // Audio received but not yet recognised, starting `pendingStart` samples into the audio.
    let pending = new Float32Array(0);
    let pendingStart = 0;
    let stopped = false;

    const append = (at: number, samples: Float32Array) => {
        const end = pendingStart + pending.length;
        // A chunk that starts later leaves silence before it; one that starts earlier loses the overlap.
        const gap = Math.max(0, at - end);
        const skip = Math.max(0, end - at);
        if (skip >= samples.length && !gap) return;
        const next = new Float32Array(pending.length + gap + Math.max(0, samples.length - skip));
        next.set(pending);
        next.set(samples.subarray(skip), pending.length + gap);
        pending = next;
    };

    // Progress never goes back, though a second pass over a window starts behind the first.
    let reported = 0;
    const report = (done: number) => {
        if (done < reported) return;
        reported = done;
        onProgress?.(done, totalSeconds);
    };

    /** Whisper's segments for the window from `at` seconds in, in seconds within the window. */
    const listen = async (window: Float32Array, offset: number, at = 0) => {
        const audio = window.subarray(Math.round(at * SAMPLE_RATE));
        const seconds = audio.length / SAMPLE_RATE;
        // Within a window, progress follows the timestamps Whisper writes as it goes.
        const output = await recognize(audio, { return_timestamps: true, language, task: "transcribe" },
            position => report(offset + at + clamp(position, 0, seconds)));
        const found = output.chunks ?? (output.text?.trim() ? [{ timestamp: [0, seconds] as [number, number], text: output.text }] : []);
        // A segment Whisper left open, or timed past the audio it was given, ends with that audio.
        return found.map(chunk => {
            const [begin, end] = chunk.timestamp;
            const start = clamp(begin ?? 0, 0, seconds);
            return { start: at + start, end: at + clamp(end ?? seconds, start, seconds), text: chunk.text.trim() };
        }).filter(segment => segment.text);
    };

    const recogniseReady = async (final: boolean) => {
        let from = 0;
        while (!stopped) {
            if (signal?.aborted) { stopped = true; break; }
            const rest = pending.subarray(from);
            const length = windowEnd(rest, final);
            if (length === null) break;
            const window = rest.subarray(0, length);
            const offset = (pendingStart + from) / SAMPLE_RATE;
            if (!isSilent(window)) {
                const timed = await listen(window, offset);
                const floor = noiseFloor(window);
                for (let retry = 0; retry < RETRIES && timed.length && !signal?.aborted; retry++) {
                    const last = timed[timed.length - 1];
                    const resume = unheardSpeech(window, last.start, last.end, floor);
                    if (resume === null) break;
                    const more = await listen(window, offset, resume);
                    if (!more.length) break;
                    // Asked again from inside the last segment, Whisper may write some of its words again.
                    const inside = resume < last.end;
                    last.text = withoutRepeat(last.text, more[0].text, inside ? 1 : 2);
                    if (inside) last.end = resume;
                    if (!last.text) timed.pop();
                    timed.push(...more);
                }
                // Whisper's segment times are coarse: shared boundaries move into the pause between
                // sentences, then each segment is drawn in to the sound inside it (timing.ts).
                snapToPauses(timed, pausesIn(window, floor));
                for (const segment of timed) {
                    const [begin, end] = tightenToSpeech(window, segment.start, segment.end, floor) ?? [segment.start, segment.end];
                    const start = round(offset + begin);
                    let stop = round(offset + end);
                    // No words come from a stretch the browser could not decode: it was silence to Whisper.
                    if (unreadable.some(range => start >= range.start && start < range.end)) continue;
                    for (const range of unreadable) if (start < range.start && stop > range.start) stop = range.start;
                    segments.push({ start, end: stop, text: segment.text });
                }
            }
            from += length;
            totalSeconds = Math.max(totalSeconds, (pendingStart + from) / SAMPLE_RATE);
            report((pendingStart + from) / SAMPLE_RATE);
            await yieldToPage();
        }
        pendingStart += from;
        pending = pending.slice(from);
    };

    report(0);
    for await (const chunk of chunks) {
        const at = Math.round(chunk.start * SAMPLE_RATE);
        if ("unreadableSeconds" in chunk) {
            unreadable.push({ start: round(chunk.start), end: round(chunk.start + chunk.unreadableSeconds) });
            append(at, new Float32Array(Math.round(chunk.unreadableSeconds * SAMPLE_RATE)));
        } else {
            append(at, chunk.samples);
        }
        await recogniseReady(false);
        if (stopped) break;
    }
    if (!stopped) await recogniseReady(true);
    const doneSeconds = stopped ? pendingStart / SAMPLE_RATE : Math.max(totalSeconds, pendingStart / SAMPLE_RATE);
    return { segments, doneSeconds, totalSeconds: stopped ? totalSeconds : doneSeconds, stopped, unreadable };
}
