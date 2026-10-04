/**
 * How Voice Noise Remover's own failures are told apart from the visitor's
 * file. A module of its own, so the page can name them without loading the
 * engine, which loads only when a recording is cleaned.
 */

/** The noise remover itself failed to load or run in this browser: never the visitor's file. */
export class NoiseEngineError extends Error {
    readonly name = "NoiseEngineError";
    constructor(message: string, readonly reason: "wasm" | "worker" | "stopped") {
        super(message);
    }
}

/** An error that says the browser ran out of memory: "Array buffer allocation failed" (Chromium), "out of memory" (Firefox, Safari). */
export function outOfMemory(error: { name?: string; message?: string; cause?: unknown } | null | undefined): boolean {
    if (!error) return false;
    if (error.cause === "memory") return true;
    return (error.name === "RangeError" || error.name === "InternalError") && /memory|allocation/i.test(error.message ?? "");
}
