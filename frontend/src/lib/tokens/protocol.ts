/**
 * The messages between the page (engine.ts) and the token workers
 * (tokens-o200k.worker.ts, tokens-cl100k.worker.ts). An error crosses as plain data and is made again on
 * the page as the same kind of error, with its words for the visitor and
 * its analytics category, so the page handles it as if it were its own.
 */
import type { ToolErrorKind } from "@/lib/toolRun";
import { ReadError, tagged, type ReadFailure } from "./errors";
import { TooManyChunksError } from "./split";
import type { GptEncodingId } from "./gpt";

export type TokenRequest =
    | { type: "docx"; id: number; bytes: Uint8Array; name: string }
    | { type: "count"; id: number; text: string }
    | { type: "split"; id: number; text: string; maxTokens: number; encoding: GptEncodingId };

export interface WorkerFailure {
    name: string;
    message: string;
    code?: ReadFailure;
    kind?: ToolErrorKind;
}

export type TokenReply =
    /** The worker's script has loaded and runs. */
    | { type: "ready" }
    | { type: "progress"; id: number; fraction: number; detail?: string }
    | { type: "result"; id: number; value: unknown }
    | { type: "error"; id: number; error: WorkerFailure };

export function describeFailure(error: unknown): WorkerFailure {
    if (!(error instanceof Error)) return { name: "Error", message: String(error) };
    const failure: WorkerFailure = { name: error.name, message: error.message };
    if (error instanceof ReadError) failure.code = error.code;
    const kind = (error as { __kind?: ToolErrorKind }).__kind;
    if (kind) failure.kind = kind;
    return failure;
}

export function failureError(failure: WorkerFailure): Error {
    if (failure.name === "ReadError" && failure.code) return new ReadError(failure.code, failure.message, failure.kind);
    if (failure.name === "TooManyChunksError") return new TooManyChunksError();
    const error = new Error(failure.message);
    error.name = failure.name;
    return failure.kind ? tagged(error, failure.kind) : error;
}
