/** A stretch of a file's sound that the browser can decode on its own. */
export interface AudioPiece {
    /** Where its sound starts, in seconds from the start of the video or recording. */
    start: number;
    /** How long the container says it lasts, in seconds. */
    duration: number;
    /** The piece as a complete stream for decodeAudioData. */
    read: () => Promise<ArrayBuffer>;
}

/** A file's sound as pieces of about a minute, found by reading its container. */
export interface AudioIndex {
    /** The container, for messages: "MP4", "Matroska", "MP3", "WAV". */
    container: string;
    /** The length of the sound, in seconds. */
    durationSeconds: number;
    pieces: AudioPiece[];
}

/** How much sound each piece holds, in seconds: small enough to decode in a few tens of megabytes. */
export const PIECE_SECONDS = 60;

/** The container was read and holds no audio track at all. */
export class NoSoundTrack extends Error {
    readonly name = "NoSoundTrack";
    constructor() { super("This file has no sound track."); }
}
