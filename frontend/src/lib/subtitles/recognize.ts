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
 * What Whisper writes is checked (quality.ts). Punctuation alone is left
 * out, and so is a stock line ("Thank you.") written over silence.
 *
 * A window written as one phrase over and over, as a whole or within one long
 * segment, is heard again in two halves, cut at a pause near its middle,
 * with no three words allowed to repeat (openai-whisper decodes again on a
 * loop; where a window's boundaries fall changes what Whisper writes). When
 * the halves write mostly the same words, the first pass was a real chant or
 * refrain and stands. Otherwise the looping segments of a half that still
 * loops are left out, and a half that still loops, or uses far too few
 * different words, is left out whole; either way its stretch is reported,
 * like one the browser could not decode.
 *
 * When Whisper stops writing before the speech in a window ends, it is asked
 * again from the speech it left out, at most twice a window (timing.ts says
 * where). Each segment of that second pass is kept unless it is what Whisper
 * writes over music or noise: a stock line, a loop, far too little text for
 * the voice in its time, or mostly the same words as the first pass wrote for
 * the same stretch. After a segment is left out, the window is not asked
 * again.
 */
import type { SpeechSegment } from "@/lib/speechTranscript";
import { hasWords, isLongLoop, isLoop, isStockLine, mostlySame, sharesMost, tooFewWords, tooSparse, wordsOf } from "./quality";
import { fitToText, noiseFloor, pausesIn, quietThroughout, snapToPauses, splitAtPauses, tightenToSpeech, unheardSpeech } from "./timing";
import { isSilent, middleCut, SAMPLE_RATE, windowEnd } from "./windows";

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
    /** Stretches where Whisper wrote only a loop, in seconds: their words are left out. */
    unclear: { start: number; end: number }[];
}

/** A task boundary rather than a microtask: the page draws and handles input before the next window. */
export function nextTask(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** How many more times Whisper is asked for speech it left out of one window. */
const RETRIES = 2;

type Timed = { start: number; end: number; text: string };

const textOf = (segments: readonly Timed[]) => segments.map(segment => segment.text).join(" ");

/**
 * `earlier` without the words at its end that `later` starts with: the same
 * speech, written by two passes over the same stretch. At most `most` words
 * go, the ones that can lie in that stretch, and never all of them.
 */
export function withoutRepeat(earlier: string, later: string, most: number): string {
    const first = wordsOf(earlier);
    const second = wordsOf(later);
    for (let count = Math.min(first.length - 1, second.length, most); count >= 1; count--) {
        const tail = first.slice(first.length - count);
        if (tail.every((word, i) => word.word === second[i].word)) return earlier.slice(0, tail[0].index).replace(/[\s,;:–—-]+$/u, "");
    }
    return earlier;
}

/**
 * Whether a segment of a second pass is speech rather than what Whisper
 * writes over music or noise: not a stock line or a loop, not far too little
 * text for the voice in its time (judged after drawing it in to that voice,
 * so a short reply isn't judged on Whisper's padded time), and not mostly the
 * same words as the first pass wrote for the same stretch.
 */
function heardAsSpeech(segment: Timed, firstPass: readonly Timed[], window: Float32Array, floor: number): boolean {
    if (isStockLine(segment.text) || isLoop(segment.text)) return false;
    const [start, end] = tightenToSpeech(window, segment.start, segment.end, floor) ?? [segment.start, segment.end];
    if (tooSparse({ start, end, text: segment.text })) return false;
    const sameStretch = firstPass.filter(earlier => earlier.start < segment.end && earlier.end > segment.start);
    return !sameStretch.length || !sharesMost(segment.text, textOf(sameStretch));
}

const plain = (text: string) => wordsOf(text).map(({ word }) => word).join(" ");

/**
 * The segments of a window that still loops after Whisper heard it again,
 * without the looping ones: a segment that loops on its own, or three or more
 * in a row that say the same. When what is left still loops, nothing is kept.
 */
function withoutLoops(segments: readonly Timed[]): { kept: Timed[]; dropped: Timed[] } {
    const looping = segments.map(segment => isLoop(segment.text));
    for (let i = 0; i < segments.length;) {
        let j = i + 1;
        while (j < segments.length && plain(segments[j].text) === plain(segments[i].text)) j++;
        if (j - i >= 3) for (let k = i; k < j; k++) looping[k] = true;
        i = j;
    }
    let kept = segments.filter((_, i) => !looping[i]);
    if (isLoop(textOf(kept))) kept = [];
    return { kept, dropped: segments.filter(segment => !kept.includes(segment)) };
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
    const unclear: { start: number; end: number }[] = [];
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

    /** Whisper's segments for the window from `at` seconds in, to `until`, in seconds within the window, none of punctuation alone. */
    const listen = async (window: Float32Array, offset: number, at = 0, extra: Record<string, unknown> = {}, until?: number): Promise<Timed[]> => {
        const audio = window.subarray(Math.round(at * SAMPLE_RATE), until === undefined ? undefined : Math.round(until * SAMPLE_RATE));
        const seconds = audio.length / SAMPLE_RATE;
        // Within a window, progress follows the timestamps Whisper writes as it goes.
        const output = await recognize(audio, { return_timestamps: true, language, task: "transcribe", ...extra },
            position => report(offset + at + clamp(position, 0, seconds)));
        const found = output.chunks ?? (output.text?.trim() ? [{ timestamp: [0, seconds] as [number, number], text: output.text }] : []);
        // A segment Whisper left open, or timed past the audio it was given, ends with that audio.
        return found.map(chunk => {
            const [begin, end] = chunk.timestamp;
            const start = clamp(begin ?? 0, 0, seconds);
            return { start: at + start, end: at + clamp(end ?? seconds, start, seconds), text: chunk.text.trim() };
        }).filter(segment => hasWords(segment.text));
    };

    /** A stretch, in seconds from the start of the audio, whose words were left out; one that touches the last joins it. */
    const leaveOut = (start: number, end: number) => {
        const previous = unclear[unclear.length - 1];
        if (previous && start - previous.end <= 1) previous.end = Math.max(previous.end, round(end));
        else unclear.push({ start: round(start), end: round(end) });
    };

    /** What Whisper heard in one window, checked, in seconds within the window. */
    const hearWindow = async (window: Float32Array, offset: number, floor: number): Promise<Timed[]> => {
        let timed = await listen(window, offset);
        // A loop over the whole window, or one segment long enough that speech rarely makes it a loop.
        const loops = (segments: readonly Timed[]) => isLoop(textOf(segments)) || segments.some(segment => isLongLoop(segment.text));
        if (loops(timed)) {
            const seconds = window.length / SAMPLE_RATE;
            const cut = middleCut(window) / SAMPLE_RATE;
            const heard: Timed[] = [];
            const missing: [number, number][] = [];
            for (const [from, to] of [[0, cut], [cut, seconds]]) {
                const half = await listen(window, offset, from, { no_repeat_ngram_size: 3 }, to);
                const { kept, dropped } = loops(half) ? withoutLoops(half) : { kept: half, dropped: [] as Timed[] };
                if (tooFewWords(textOf(kept)) || loops(kept)) {
                    missing.push([from, to]);
                    continue;
                }
                for (const segment of dropped) missing.push([segment.start, segment.end]);
                heard.push(...kept);
            }
            // The halves wrote mostly what the first pass did: it was a real chant or refrain, not a loop.
            if (!missing.length && mostlySame(textOf(timed), textOf(heard))) {
                // The first pass stands.
            } else {
                for (const [from, to] of missing) leaveOut(offset + from, offset + to);
                timed = heard;
            }
        }
        for (let retry = 0; retry < RETRIES && timed.length && !signal?.aborted; retry++) {
            const last = timed[timed.length - 1];
            const resume = unheardSpeech(window, last.start, last.end, floor);
            if (resume === null) break;
            const more = await listen(window, offset, resume);
            // A second pass that is one loop, however it is cut into segments, heard nothing.
            if (!more.length || isLoop(textOf(more))) break;
            // Asked again from inside the last segment, Whisper may write some of its words again:
            // no more of them than can lie in the stretch both passes heard.
            const inside = resume < last.end;
            const words = wordsOf(last.text).length;
            const shared = inside ? Math.ceil(words * (last.end - resume) / Math.max(last.end - last.start, 0.001)) : 0;
            const trimmed = shared ? withoutRepeat(last.text, more[0].text, shared) : last.text;
            const firstPass = [...timed.slice(0, -1), { ...last, text: trimmed }];
            const kept = more.filter(segment => heardAsSpeech(segment, firstPass, window, floor));
            // The last segment gives up the shared stretch only to a second pass that kept what it heard there.
            if (inside && kept[0] === more[0]) {
                last.text = trimmed;
                last.end = resume;
            }
            timed.push(...kept);
            if (kept.length < more.length) break;
        }
        return timed;
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
                const floor = noiseFloor(window);
                const timed = await hearWindow(window, offset, floor);
                // Whisper's segment times are coarse: shared boundaries move into the pause between
                // sentences, each segment is drawn in to the sound inside it, and a run still far
                // longer than its text takes to say gets the time its text takes (timing.ts).
                snapToPauses(timed, pausesIn(window, floor));
                const tightened = timed.flatMap(segment => {
                    const tight = tightenToSpeech(window, segment.start, segment.end, floor);
                    // A stock line over silence is Whisper writing when it hears nothing.
                    if (!tight && isStockLine(segment.text) && quietThroughout(window, segment.start, segment.end, floor)) return [];
                    const [begin, end] = tight ?? [segment.start, segment.end];
                    return [{ start: begin, end, text: segment.text }];
                });
                // Sentences Whisper wrote as one segment across a clear pause become one caption each.
                const fitted = splitAtPauses(window, tightened, floor);
                fitToText(window, fitted);
                for (const segment of fitted) {
                    const start = round(offset + segment.start);
                    let stop = round(offset + segment.end);
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
    return { segments, doneSeconds, totalSeconds: stopped ? totalSeconds : doneSeconds, stopped, unreadable, unclear };
}
