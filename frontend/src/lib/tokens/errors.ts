/**
 * Why the token counter couldn't read or count an input, worded for the
 * visitor, with the reason as a code. Kept free of lib/api, whose toast
 * library has no place in the token workers (tokens-o200k.worker.ts and
 * tokens-cl100k.worker.ts).
 */
import type { ToolErrorKind } from "@/lib/toolRun";

export type ReadFailure =
    | "too-large" | "empty" | "binary" | "text-too-long" | "long-run"
    | "pdf-unreadable" | "pdf-password" | "pdf-no-text"
    | "docx-unreadable" | "docx-too-large";

/** The tag lib/api's withErrorKind sets, which toolErrorKind reads for the analytics category. */
export function tagged<E extends Error>(error: E, kind: ToolErrorKind): E {
    (error as { __kind?: ToolErrorKind }).__kind = kind;
    return error;
}

export class ReadError extends Error {
    readonly code: ReadFailure;
    constructor(code: ReadFailure, message: string, kind: ToolErrorKind = "bad_input") {
        super(message);
        this.name = "ReadError";
        this.code = code;
        tagged(this, kind);
    }
}

export function abortError(): DOMException {
    return new DOMException("The count was cancelled.", "AbortError");
}
