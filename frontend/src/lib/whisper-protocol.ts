/** The messages between the page (lib/whisper.ts) and the Whisper worker (lib/whisper.worker.ts). */
export type WhisperRequest =
    | { type: "load"; id: number; hfId: string; bytes: number }
    /** `positions`: report how far into the audio Whisper has written, as it writes. */
    | { type: "run"; id: number; hfId: string; audio: Float32Array; options: Record<string, unknown>; positions?: boolean };

export type WhisperReply =
    | { type: "progress"; id: number; percent: number }
    /** Seconds into the audio of the latest timestamp Whisper has written. */
    | { type: "position"; id: number; seconds: number }
    | { type: "ready"; id: number }
    | { type: "result"; id: number; output: unknown }
    | { type: "error"; id: number; name: string; message: string; network: boolean };
