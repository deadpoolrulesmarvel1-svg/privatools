/**
 * The sound of a video or recording, as 16 kHz mono for Whisper, read in this
 * browser.
 *
 * decodeAudioData, the browser's decoder, decodes a whole file at once and
 * holds it several times over: measured in Chromium, a 30-minute video took
 * 2.5 GB and an hour of AAC 4.2 GB. So the containers people use for video
 * and speech (MP4, MOV, M4A, WebM, MKV, MP3, WAV) are read here a piece of
 * about a minute at a time: each piece is decoded, mixed to mono at 16 kHz
 * and handed on, and memory stays near a piece's worth however long the
 * file is. Other files the browser may still decode (Ogg, FLAC, fragmented
 * MP4) are decoded whole, which this tool allows up to WHOLE_FILE_SECONDS.
 */
import { decodeToMono, WHISPER_SAMPLE_RATE as SAMPLE_RATE } from "@/lib/whisper";
import type { AudioChunk } from "../recognize";
import { playingTime, sniff } from "./probe";
import { indexMatroska } from "./matroska";
import { indexMp3 } from "./mp3";
import { indexMp4, isFragmentedMp4 } from "./mp4";
import { NoSoundTrack, PIECE_SECONDS, type AudioIndex } from "./types";
import { indexWav } from "./wav";

export { playingTime, sniff, type MediaKind } from "./probe";

/** The longest sound this tool takes: past it, a run would take hours in a browser tab. */
export const MAX_SECONDS = 3 * 60 * 60;
/** The longest sound decoded whole, for formats not read in pieces: about a gigabyte of the decoder's memory. */
export const WHOLE_FILE_SECONDS = 15 * 60;
/** For a whole-file format whose length the browser cannot tell before decoding. */
export const WHOLE_FILE_BYTES = 150 * 1024 * 1024;

export type MediaProblem = "empty" | "unreadable" | "no-sound" | "too-long" | "too-long-whole";

/** Why a file's sound cannot be read, in words for the visitor. */
export class MediaError extends Error {
    readonly name = "MediaError";
    constructor(readonly problem: MediaProblem, message: string, readonly seconds?: number) {
        super(message);
    }
}

export interface AudioSource {
    /** "MP4", "Matroska", "MP3", "WAV", or "whole file". */
    container: string;
    /** Seconds of sound. */
    durationSeconds: number;
    /** 16 kHz mono chunks in order. A piece that fails to decode, after the first, comes as unreadable rather than ending the run. */
    chunks: () => AsyncGenerator<AudioChunk>;
}

const minutes = (seconds: number) => `${Math.round(seconds / 60)} minutes`;

function tooLong(seconds: number): MediaError {
    const hours = Math.floor(seconds / 3600);
    const rest = Math.round((seconds % 3600) / 60);
    const length = hours ? `${hours} h ${rest} min` : `${rest} minutes`;
    return new MediaError("too-long", `This file’s sound is ${length} long. Subtitle Generator takes up to ${MAX_SECONDS / 3600} hours at a time.`, seconds);
}

async function* piecesOf(index: AudioIndex, signal?: AbortSignal): AsyncGenerator<AudioChunk> {
    for (let i = 0; i < index.pieces.length; i++) {
        signal?.throwIfAborted();
        const piece = index.pieces[i];
        try {
            yield { start: piece.start, samples: await decodeToMono(await piece.read()) };
        } catch (error) {
            // The first piece decides whether this browser can decode the sound at all.
            if (i === 0) throw unreadable(error);
            yield { start: Math.max(0, piece.start), unreadableSeconds: piece.duration };
        }
    }
}

function unreadable(error?: unknown): MediaError {
    if (error instanceof MediaError) return error;
    return new MediaError("unreadable", "This browser can’t decode the sound in this file.");
}

/**
 * Why a file's sound is decoded whole, in words for the visitor, by what its
 * first bytes say it is: a sentence that opens a message, or one that follows
 * a sentence about the file.
 */
async function decodedWhole(file: File, kind: Awaited<ReturnType<typeof sniff>>, opens: boolean): Promise<string> {
    const limit = `up to ${minutes(WHOLE_FILE_SECONDS)} of sound`;
    const it = opens ? "This file" : "It";
    if (kind === "mp4") {
        return await isFragmentedMp4(file)
            ? `${it} is written in fragments, as some recorders save video, which this browser decodes whole, ${limit}.`
            : `${opens ? "This file’s" : "Its"} sound isn’t AAC or MP3, the kinds read a minute at a time, so this browser decodes it whole, ${limit}.`;
    }
    if (kind === "matroska") return `${it} can’t be read a minute at a time, so this browser decodes it whole, ${limit}.`;
    return `Files in this format are decoded whole in this browser, ${limit}.`;
}

/**
 * Open a file's sound. Fails with a MediaError, before any model is fetched,
 * when the file is empty or has no sound track, the format is one the browser
 * cannot read, or the sound is longer than this tool takes. `onRead` hears how
 * far the readers that walk a whole file (WebM, MKV, MP3) have got, in bytes;
 * `signal` stops them, and the pieces after them.
 */
export async function openAudio(file: File, { onRead, measure = playingTime, pieceSeconds = PIECE_SECONDS, signal }: {
    onRead?: (bytes: number) => void;
    /** How long a file plays by the browser's reckoning: playingTime, or a stand-in in tests. */
    measure?: (file: Blob, video: boolean) => Promise<number | null>;
    pieceSeconds?: number;
    signal?: AbortSignal;
} = {}): Promise<AudioSource> {
    if (!file.size) throw new MediaError("empty", "This file is empty, so there is no sound in it.");
    const kind = await sniff(file);
    let index: AudioIndex | null = null;
    try {
        index = kind === "mp4" ? await indexMp4(file, pieceSeconds)
            : kind === "matroska" ? await indexMatroska(file, { pieceSeconds, onRead, signal })
            : kind === "mp3" ? await indexMp3(file, { pieceSeconds, onRead, signal })
            : kind === "wav" ? await indexWav(file, { pieceSeconds })
            : null;
    } catch (error) {
        if (error instanceof NoSoundTrack) throw new MediaError("no-sound", "This file has no sound track, so there is nothing to subtitle.");
        signal?.throwIfAborted();
        index = null;
    }
    signal?.throwIfAborted();
    if (index) {
        if (index.durationSeconds > MAX_SECONDS) throw tooLong(index.durationSeconds);
        const found = index;
        return { container: found.container, durationSeconds: found.durationSeconds, chunks: () => piecesOf(found, signal) };
    }

    // The whole-file path: the browser's own decoder, bounded by length.
    const seconds = await measure(file, file.type.startsWith("video/") || kind === "mp4" || kind === "matroska");
    signal?.throwIfAborted();
    if (seconds === null && file.size > WHOLE_FILE_BYTES) {
        throw new MediaError("too-long-whole", `${await decodedWhole(file, kind, true)} This browser can’t tell how long this file plays without decoding all of it, so it takes files like it up to ${WHOLE_FILE_BYTES / 1024 / 1024} MB.`);
    }
    if (seconds !== null && seconds > MAX_SECONDS) throw tooLong(seconds);
    if (seconds !== null && seconds > WHOLE_FILE_SECONDS) {
        throw new MediaError("too-long-whole", `This file’s sound is ${minutes(seconds)} long. ${await decodedWhole(file, kind, false)}`, seconds);
    }
    let samples: Float32Array;
    try {
        samples = await decodeToMono(await file.arrayBuffer());
    } catch (error) {
        throw unreadable(error);
    }
    signal?.throwIfAborted();
    if (samples.length / SAMPLE_RATE > WHOLE_FILE_SECONDS + 1) {
        throw new MediaError("too-long-whole", `This file’s sound is ${minutes(samples.length / SAMPLE_RATE)} long. ${await decodedWhole(file, kind, false)}`, samples.length / SAMPLE_RATE);
    }
    const decoded = samples;
    return {
        container: "whole file",
        durationSeconds: decoded.length / SAMPLE_RATE,
        chunks: async function* () { yield { start: 0, samples: decoded }; },
    };
}
