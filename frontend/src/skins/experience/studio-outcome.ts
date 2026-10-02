import type { ToolErrorKind } from "@/lib/toolRun";

/** How a run ended: everything worked, some files failed, or nothing was made. */
export type StudioOutcome = "success" | "partial" | "failure";

/** Pick the outcome from counts of finished and failed files. */
export function studioOutcome(done: number, failed: number): StudioOutcome {
    return done === 0 ? "failure" : failed > 0 ? "partial" : "success";
}

/** What went wrong with a failure another attempt could fix, from its recorded
 *  kind. Each line says only what the kind establishes. */
const RETRY_LINES: Partial<Record<ToolErrorKind, string>> = {
    timeout: "It ran out of time. Trying again may work, or try a smaller file.",
    rate_limited: "Too many requests just now. Wait a moment, then try again.",
    network: "The connection dropped.",
    server: "The server couldn’t finish it.",
};

/** One line for the retryable failures of a run: their shared cause, or no cause at all. */
export function retryLine(kinds: readonly (ToolErrorKind | undefined)[]): string {
    const distinct = [...new Set(kinds)];
    const only = distinct.length === 1 ? distinct[0] : undefined;
    return (only && RETRY_LINES[only]) || "Trying again may work.";
}

/** The kinds of the failed entries that another attempt could fix. */
export function retryKinds(entries: readonly { status: string; retryable?: boolean; errorKind?: ToolErrorKind }[]): (ToolErrorKind | undefined)[] {
    return entries.filter(entry => (entry.status === "failed" || entry.status === "error") && entry.retryable).map(entry => entry.errorKind);
}

/** The line under a failure's heading: nothing was made, and whether trying again can help. */
export function failureDetail(failed: number, retryable: readonly (ToolErrorKind | undefined)[]): string {
    const count = retryable.length;
    if (count > 0 && count >= failed) return `Nothing was created. ${retryLine(retryable)}`;
    if (count > 0) return `Nothing was created. The reasons are below; trying again may work for ${count === 1 ? "one of the files" : `${count} of the files`}.`;
    return failed > 1 ? "Nothing was created. The reasons are below." : "Nothing was created. The reason is below.";
}

/** A partial run's line about what didn't work: how many, and that each reason is on its file's row. */
export function partialLine(failed: number, verb = "processed"): string {
    return failed === 1 ? `One file couldn’t be ${verb}; the reason is below.` : `${failed} files couldn’t be ${verb}; the reasons are below.`;
}

/**
 * The download policy's second chance. A finished run downloads its result by
 * itself, once: one file, or one ZIP for several (useDownloadOnce). The
 * result then offers it again under this name.
 */
export function downloadAgainLabel(results: number): string {
    return results > 1 ? "Download ZIP again" : "Download again";
}

/** What a result says about the download that started by itself. */
export function downloadStarted(results: number): string {
    return results > 1 ? "The ZIP download has started." : "The download has started.";
}
