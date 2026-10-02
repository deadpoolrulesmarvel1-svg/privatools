/** How a run ended: everything worked, some files failed, or nothing was made. */
export type StudioOutcome = "success" | "partial" | "failure";

/** Pick the outcome from counts of finished and failed files. */
export function studioOutcome(done: number, failed: number): StudioOutcome {
    return done === 0 ? "failure" : failed > 0 ? "partial" : "success";
}

/** The line under a failure's heading: nothing was made, and whether trying again can help. */
export function failureDetail(failed: number, retryable: number): string {
    if (retryable > 0 && retryable >= failed) return "Nothing was created. The connection or the server got in the way, so trying again may work.";
    if (retryable > 0) return `Nothing was created. The reasons are below; trying again may work for ${retryable === 1 ? "one of the files" : `${retryable} of the files`}.`;
    return failed > 1 ? "Nothing was created. The reasons are below." : "Nothing was created. The reason is below.";
}
