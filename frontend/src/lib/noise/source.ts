/**
 * A recording's sound, read on the page for Voice Noise Remover's worker.
 *
 * Subtitle Generator's container readers (lib/subtitles/media) find the sound
 * in MP4, MOV, M4A, WebM, MKV, MP3 and WAV files without loading the file,
 * and cut it into pieces of about a minute, so memory holds a piece however
 * long the recording is. A WAV piece is plain samples, read by the worker
 * itself. Any other piece is decoded here by the browser (decodeAudioData,
 * which decodes off the page's thread; only its result arrives here), at the
 * rate the sound is stored at, and handed to the worker, which joins the
 * pieces (stitch.ts): each piece after the first is decoded with a second of
 * the sound before it, its lead, for the joins to be made where the decoder
 * has settled. Other files the browser may decode (Ogg, Opus, FLAC, AAC, MP4s
 * written in fragments) are decoded whole, up to 15 minutes.
 *
 * Nothing here leaves the device: the readers read the file with Blob.slice
 * and the browser's decoder works in memory.
 */
import { playingTime, sniff } from "@/lib/subtitles/media/probe";
import { indexMatroska } from "@/lib/subtitles/media/matroska";
import { indexMp3 } from "@/lib/subtitles/media/mp3";
import { indexMp4, isFragmentedMp4 } from "@/lib/subtitles/media/mp4";
import { NoSoundTrack, PIECE_SECONDS, type AudioIndex } from "@/lib/subtitles/media/types";
import { indexWav } from "@/lib/subtitles/media/wav";

/** The longest recording cleaned at once: an hour of mono. See the guide for the time and memory it takes. */
export const MAX_SECONDS = 60 * 60;
/**
 * The longest stereo recording: half an hour. The cleaned WAV stays in the
 * browser's memory while the visitor compares and downloads it (Chromium kept
 * all of it in RAM in review), and stereo takes twice the room of mono, so
 * both limits come to the same WAV, about 345 MB.
 */
export const MAX_STEREO_SECONDS = 30 * 60;
/** The longest sound decoded whole, for formats not read in pieces: at 48 kHz stereo, about 350 MB of samples. */
export const WHOLE_FILE_SECONDS = 15 * 60;
/**
 * How far past a limit a file may run and still be taken. Encoders pad a
 * recording's end (an hour of MP3 comes out at 60:00.04), and a length is
 * told in whole minutes, so anything refused must read as longer than the
 * limit: 30 seconds over is the first length that rounds to a minute more.
 */
const SLACK_SECONDS = 30;
const over = (seconds: number, limit: number) => seconds >= limit + SLACK_SECONDS;
/** For a whole-file format whose length the browser can't tell before decoding. */
export const WHOLE_FILE_BYTES = 150 * 1024 * 1024;
/** How much of the sound before each piece is decoded with it. */
export const LEAD_SECONDS = 1;
/** The rate sound is decoded at when its own rate isn't known: RNNoise's. */
const DEFAULT_RATE = 48000;

export type InputProblem = "empty" | "no-sound" | "unreadable" | "too-long" | "too-long-stereo" | "too-long-whole";

/** Why a file's sound can't be cleaned here, in words for the visitor. */
export class NoiseInputError extends Error {
    readonly name = "NoiseInputError";
    constructor(readonly problem: InputProblem, message: string, readonly seconds?: number) {
        super(message);
    }
}

export type SourceItem =
    /** Decoded sound at `rate`, one array per channel, starting at `start` − `lead` seconds. */
    | { kind: "pcm"; channels: Float32Array[]; rate: number; start: number; lead: number }
    /** A WAV piece's bytes: a header and plain samples, for the worker to read. */
    | { kind: "wav"; bytes: ArrayBuffer; start: number }
    /** A stretch this browser couldn't decode, after the first. */
    | { kind: "gap"; start: number; seconds: number };

export interface NoiseSource {
    /** "MP4", "Matroska", "MP3", "WAV" or "whole file". */
    container: string;
    durationSeconds: number;
    /** The sound in order. The first item is always sound: a file whose start can't be decoded fails instead. */
    items(): AsyncGenerator<SourceItem>;
}

/**
 * Decode a complete stream at (about) `rate`; the result says the rate it is
 * at. The arrays may be the decoder's own (an AudioBuffer's), so what is sent
 * to the worker is copied from them: sending moves an array's memory, and
 * only arrays the page made itself are moved.
 */
export type Decode = (bytes: ArrayBuffer, rate: number) => Promise<{ channels: Float32Array[]; rate: number }>;

/**
 * The browser's own decoder. An offline context touches no audio device. It
 * hands back the AudioBuffer's own arrays rather than copies: for a file
 * decoded whole, a copy would hold the sound twice over, 344 MB more at 15
 * minutes of stereo.
 */
export function browserDecoder(): Decode {
    const contexts = new Map<number, OfflineAudioContext>();
    return async (bytes, rate) => {
        let context = contexts.get(rate);
        if (!context) {
            try {
                context = new OfflineAudioContext(1, 1, rate);
            } catch {
                // A rate this browser's contexts don't take: decode at RNNoise's.
                context = contexts.get(DEFAULT_RATE) ?? new OfflineAudioContext(1, 1, DEFAULT_RATE);
            }
            contexts.set(rate, context);
        }
        const audio = await context.decodeAudioData(bytes);
        const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
        return { channels, rate: audio.sampleRate };
    };
}

/**
 * The rate to decode a container's sound at: the rate it is stored at, so no
 * resampling happens before the worker's own. Opus always decodes at 48 kHz;
 * AAC at 24 kHz or less may be HE-AAC, whose decoder doubles the rate, so it
 * is decoded at twice its stored rate rather than losing its top half.
 */
export function decodeRate({ sampleRate, codec }: Pick<AudioIndex, "sampleRate" | "codec">): number {
    if (codec === "opus" || !sampleRate || sampleRate < 8000) return DEFAULT_RATE;
    const rate = codec === "aac" && sampleRate <= 24000 ? sampleRate * 2 : sampleRate;
    return Math.min(rate, 96000);
}

/** "1 h 5 min", "42 minutes", "under a minute". */
export function lengthWords(seconds: number): string {
    const minutesTotal = Math.round(seconds / 60);
    if (seconds < 60) return "under a minute";
    const hours = Math.floor(minutesTotal / 60);
    const minutes = minutesTotal % 60;
    if (!hours) return `${minutesTotal} minute${minutesTotal === 1 ? "" : "s"}`;
    return minutes ? `${hours} h ${minutes} min` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

function tooLong(seconds: number): NoiseInputError {
    return new NoiseInputError("too-long", `This file’s sound is ${lengthWords(seconds)} long. Voice Noise Remover takes up to ${MAX_SECONDS / 60} minutes at a time.`, seconds);
}

/**
 * Refuse stereo past its limit. Two channels make a stereo WAV; one, or more
 * than two (mixed to one), make a mono WAV, which may run to the full hour.
 */
function checkStereo(channels: number, seconds: number): void {
    if (channels !== 2 || !over(seconds, MAX_STEREO_SECONDS)) return;
    throw new NoiseInputError("too-long-stereo", `This file’s sound is stereo and ${lengthWords(seconds)} long. Voice Noise Remover takes stereo up to ${MAX_STEREO_SECONDS / 60} minutes and mono up to ${MAX_SECONDS / 60}.`, seconds);
}

function unreadable(error?: unknown): NoiseInputError {
    if (error instanceof NoiseInputError) return error;
    return new NoiseInputError("unreadable", "This browser can’t decode the sound in this file.");
}

/** Why a whole-file format is decoded whole, for messages. */
async function decodedWhole(file: File, kind: Awaited<ReturnType<typeof sniff>>): Promise<string> {
    const limit = `up to ${WHOLE_FILE_SECONDS / 60} minutes of sound`;
    if (kind === "mp4" && await isFragmentedMp4(file)) return `It is written in fragments, as some recorders save video, which this browser decodes whole, ${limit}.`;
    if (kind === "mp4") return `Its sound isn’t AAC or MP3, the kinds read a minute at a time, so this browser decodes it whole, ${limit}.`;
    if (kind === "matroska") return `It can’t be read a minute at a time, so this browser decodes it whole, ${limit}.`;
    return `Files in this format are decoded whole in this browser, ${limit}.`;
}

/**
 * Open a file's sound. Fails with a NoiseInputError, before anything is
 * cleaned, when the file is empty or has no sound track, is longer than this
 * tool takes, or (on reading its first item) can't be decoded by this
 * browser. `onRead` hears how far the readers that walk a whole file (WebM,
 * MKV, MP3) have got, in bytes; `signal` stops reading.
 */
export async function openNoiseSource(file: File, { onRead, signal, measure = playingTime, decode = browserDecoder(), pieceSeconds = PIECE_SECONDS }: {
    onRead?: (bytes: number) => void;
    signal?: AbortSignal;
    /** How long a file plays by the browser's reckoning: playingTime, or a stand-in in tests. */
    measure?: (file: Blob, video: boolean) => Promise<number | null>;
    decode?: Decode;
    pieceSeconds?: number;
} = {}): Promise<NoiseSource> {
    if (!file.size) throw new NoiseInputError("empty", "This file is empty, so there is no sound in it.");
    const kind = await sniff(file);
    let index: AudioIndex | null = null;
    try {
        index = kind === "mp4" ? await indexMp4(file, pieceSeconds, LEAD_SECONDS)
            : kind === "matroska" ? await indexMatroska(file, { pieceSeconds, leadSeconds: LEAD_SECONDS, onRead, signal })
            : kind === "mp3" ? await indexMp3(file, { pieceSeconds, leadSeconds: LEAD_SECONDS, onRead, signal })
            : kind === "wav" ? await indexWav(file, { pieceSeconds })
            : null;
    } catch (error) {
        if (error instanceof NoSoundTrack) throw new NoiseInputError("no-sound", "This file has no sound track, so there is nothing to clean.");
        signal?.throwIfAborted();
        index = null;
    }
    signal?.throwIfAborted();

    if (index) {
        if (over(index.durationSeconds, MAX_SECONDS)) throw tooLong(index.durationSeconds);
        // A WAV's header says its channels; other sound says them once its first piece is decoded.
        if (index.channels) checkStereo(index.channels, index.durationSeconds);
        const found = index;
        const wav = found.container === "WAV";
        const rate = decodeRate(found);
        return {
            container: found.container,
            durationSeconds: found.durationSeconds,
            items: async function* () {
                for (let i = 0; i < found.pieces.length; i++) {
                    signal?.throwIfAborted();
                    const piece = found.pieces[i];
                    const bytes = await piece.read();
                    if (wav) {
                        yield { kind: "wav", bytes, start: piece.start };
                        continue;
                    }
                    let decoded: Awaited<ReturnType<Decode>> | null = null;
                    try {
                        decoded = await decode(bytes, rate);
                    } catch (error) {
                        // The first piece decides whether this browser can decode the sound at all.
                        if (i === 0) throw unreadable(error);
                    }
                    signal?.throwIfAborted();
                    if (decoded?.channels.length && decoded.channels[0].length) {
                        // The first piece's channels are the WAV's: the worker keeps them for the whole file.
                        if (i === 0) checkStereo(decoded.channels.length, found.durationSeconds);
                        // A minute's copy, the worker's to keep (see Decode).
                        yield { kind: "pcm", channels: decoded.channels.map(channel => channel.slice()), rate: decoded.rate, start: piece.start, lead: piece.lead ?? 0 };
                    } else if (i === 0) {
                        throw unreadable();
                    } else {
                        yield { kind: "gap", start: piece.start, seconds: piece.duration };
                    }
                }
            },
        };
    }

    // The whole-file path: the browser's own decoder, bounded by length.
    const seconds = await measure(file, file.type.startsWith("video/") || kind === "mp4" || kind === "matroska");
    signal?.throwIfAborted();
    if (seconds === null && file.size > WHOLE_FILE_BYTES) {
        throw new NoiseInputError("too-long-whole", `${await decodedWhole(file, kind)} This browser can’t tell how long this file plays without decoding all of it, so it takes files like it up to ${WHOLE_FILE_BYTES / 1024 / 1024} MB.`);
    }
    if (seconds !== null && over(seconds, MAX_SECONDS)) throw tooLong(seconds);
    if (seconds !== null && over(seconds, WHOLE_FILE_SECONDS)) {
        throw new NoiseInputError("too-long-whole", `This file’s sound is ${lengthWords(seconds)} long. ${await decodedWhole(file, kind)}`, seconds);
    }
    const whole: NoiseSource = {
        container: "whole file",
        // Unknown until decoded when the browser can't tell beforehand; set then.
        durationSeconds: seconds ?? 0,
        items: async function* () {
            let decoded: Awaited<ReturnType<Decode>>;
            try {
                decoded = await decode(await file.arrayBuffer(), DEFAULT_RATE);
            } catch (error) {
                throw unreadable(error);
            }
            signal?.throwIfAborted();
            const length = decoded.channels[0]?.length ?? 0;
            if (!length) throw new NoiseInputError("no-sound", "This file holds no sound, so there is nothing to clean.");
            if (over(length / decoded.rate, WHOLE_FILE_SECONDS)) {
                throw new NoiseInputError("too-long-whole", `This file’s sound is ${lengthWords(length / decoded.rate)} long. ${await decodedWhole(file, kind)}`, length / decoded.rate);
            }
            whole.durationSeconds = length / decoded.rate;
            // The decoded sound is held once, as the decoder made it; each block sent is a copy of a minute of it.
            const block = Math.round(pieceSeconds * decoded.rate);
            for (let at = 0; at < length; at += block) {
                signal?.throwIfAborted();
                yield { kind: "pcm", channels: decoded.channels.map(channel => channel.slice(at, at + block)), rate: decoded.rate, start: at / decoded.rate, lead: 0 };
            }
        },
    };
    return whole;
}
