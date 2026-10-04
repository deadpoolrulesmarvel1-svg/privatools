/** A stretch of a file's sound that the browser can decode on its own. */
export interface AudioPiece {
    /** Where its sound starts, in seconds from the start of the video or recording. */
    start: number;
    /** How long the container says it lasts, in seconds. */
    duration: number;
    /**
     * Seconds of the sound before `start` that `read` includes, so a decoder
     * has settled by the piece's own sound: asked for with a reader's
     * `leadSeconds`, and 0 or absent otherwise. The stream then starts at
     * `start` − `lead`.
     */
    lead?: number;
    /** The piece as a complete stream for decodeAudioData. */
    read: () => Promise<ArrayBuffer>;
}

/** A file's sound as pieces of about a minute, found by reading its container. */
export interface AudioIndex {
    /** The container, for messages: "MP4", "Matroska", "MP3", "WAV". */
    container: string;
    /** The length of the sound, in seconds. */
    durationSeconds: number;
    /** The sound's sample rate, where the container says it. AAC's can be half the decoded rate (HE-AAC). */
    sampleRate?: number;
    /** The codec, where the reader knows it: "aac", "mp3", "opus", "vorbis", "pcm", or the container's own name for it. */
    codec?: string;
    /** The channels the sound decodes to, where the container says them exactly: WAV's plain samples. */
    channels?: number;
    pieces: AudioPiece[];
}

/** How much sound each piece holds, in seconds: small enough to decode in a few tens of megabytes. */
export const PIECE_SECONDS = 60;

/** The container was read and holds no audio track at all. */
export class NoSoundTrack extends Error {
    readonly name = "NoSoundTrack";
    constructor() { super("This file has no sound track."); }
}
