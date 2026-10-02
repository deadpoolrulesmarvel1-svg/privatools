/**
 * Usage signal for the analytics beacon: one event per tool run.
 *
 * Tool code dispatches a DOM event and never touches analytics directly, the
 * same pattern as the first-success celebration. The beacon decides whether
 * anything is sent and what the tool is called; callers only report shape.
 *
 * A failed or partly failed run also says why, as one fixed category. Callers
 * pass the caught error to emitToolRun, which classifies it here and forwards
 * only the category: the error, its message and anything else it carries
 * never leave this module.
 */
export const TOOL_RUN_EVENT = "privatools:tool-run";

export type ToolRunMode = "single" | "batch" | "pipeline";
export type ToolRunOutcome = "success" | "partial" | "error";

/**
 * Why a run failed. deploy/analytics.md documents each value; keep the two in step.
 *
 * - too_large: HTTP 413, or the browser refused a file or input over a size limit.
 * - rate_limited: HTTP 429.
 * - bad_input: HTTP 400, 415 or 422, or the browser rejected the input itself.
 * - timeout: HTTP 408, 504 or 524, or the request passed the browser's deadline.
 * - server: any other HTTP error from PrivaTools, or a response the tool could not read.
 * - network: the request never completed (offline, DNS, dropped or blocked connection).
 * - provider: the visitor's own AI provider (BYOK) refused or failed the request,
 *   or its setup is incomplete.
 * - browser: anything else raised in the browser: on-device processing, models or storage.
 *
 * A cancel is not a failure: cancelled files are not counted, and an error
 * whose cause is a cancel is not reported.
 */
export const TOOL_ERROR_KINDS = ["too_large", "rate_limited", "bad_input", "timeout", "server", "network", "provider", "browser"] as const;
export type ToolErrorKind = (typeof TOOL_ERROR_KINDS)[number];

export interface ToolRunDetail {
    /** Registry slug. Tool pages omit it; the beacon reads it from the route. */
    slug?: string;
    /** Defaults to "single" (a tool page). */
    mode?: ToolRunMode;
    outcome: ToolRunOutcome;
    /** How many files the run handled. Never names, sizes or contents. */
    files?: number;
    /** Why an error or partial run failed, when the caller knows better than its cause says. */
    errorKind?: ToolErrorKind;
}

const ERROR_KINDS: ReadonlySet<string> = new Set(TOOL_ERROR_KINDS);
// What fetch() rejects with when the request never completed, in Chromium,
// WebKit and Firefox. Read only to choose a category; never sent.
const FETCH_FAILED = /^(?:failed to fetch|load failed|networkerror when attempting to fetch|network ?error)/i;

function kindForStatus(status: number): ToolErrorKind {
    if (status === 413) return "too_large";
    if (status === 429) return "rate_limited";
    if (status === 400 || status === 415 || status === 422) return "bad_input";
    // 524: Cloudflare stopped waiting for the origin (100 s; nginx allows 300 s).
    if (status === 408 || status === 504 || status === 524) return "timeout";
    // Other 5xx, and 4xx outside the groups above: for a tool route that is a
    // deployment out of step (404, 405), not the visitor's input.
    return "server";
}

/**
 * Classify a caught error. Reads only the HTTP status and category that
 * lib/api.ts attaches (`__status`, `__kind`), error names, the BYOK error
 * kind and the browser's fetch-failure wording.
 */
export function toolErrorKind(err: unknown): ToolErrorKind | "cancelled" {
    if (typeof err !== "object" || err === null) return "browser";
    const e = err as { name?: unknown; message?: unknown; kind?: unknown; __status?: unknown; __kind?: unknown };
    if (e.name === "AbortError") return "cancelled";
    // lib/byok/errors.ts. Matched by name so this module never imports lib/byok,
    // whose importers need the provider CSP (backend _BYOK_PATHS).
    if (e.name === "ByokError") return e.kind === "Aborted" ? "cancelled" : "provider";
    if (typeof e.__status === "number") return kindForStatus(e.__status);
    if (typeof e.__kind === "string" && ERROR_KINDS.has(e.__kind)) return e.__kind as ToolErrorKind;
    if (e.name === "TimeoutError") return "timeout";
    if (e.name === "TypeError" && typeof e.message === "string" && FETCH_FAILED.test(e.message.trim())) return "network";
    return "browser";
}

/**
 * Whether the same file could succeed if the visitor tries again: the
 * connection failed, a time limit or the rate limit was reached, or the
 * server failed (5xx, or an answer it could not read). A file or setting the
 * tool refused (4xx), a size limit, the visitor's own AI provider and failures
 * inside the browser would fail the same way twice, so they are not.
 */
export function isTransientFailure(err: unknown): boolean {
    const kind = toolErrorKind(err);
    if (kind === "network" || kind === "timeout" || kind === "rate_limited") return true;
    if (kind !== "server") return false;
    const status = (err as { __status?: unknown }).__status;
    return typeof status !== "number" || status >= 500;
}

/**
 * Report one run. For an error or partial outcome, pass what the run caught
 * (the first failure, for a multi-file run) as `cause`. A run the visitor
 * cancelled is not a failure: an error whose cause is a cancel is not reported.
 */
export function emitToolRun(detail: ToolRunDetail, cause?: unknown): void {
    const { slug, mode, outcome, files } = detail;
    let errorKind = outcome === "success" ? undefined : detail.errorKind;
    if (outcome !== "success" && cause !== undefined && cause !== null) {
        const kind = toolErrorKind(cause);
        if (kind === "cancelled") {
            if (outcome === "error") return;
        } else {
            errorKind ??= kind;
        }
    }
    const clean: ToolRunDetail = { outcome };
    if (slug !== undefined) clean.slug = slug;
    if (mode !== undefined) clean.mode = mode;
    if (files !== undefined) clean.files = files;
    if (errorKind !== undefined) clean.errorKind = errorKind;
    try {
        window.dispatchEvent(new CustomEvent<ToolRunDetail>(TOOL_RUN_EVENT, { detail: clean }));
    } catch { /* */ }
}

/** Collapse per-file results into one outcome; null when nothing ran. */
export function runOutcome(done: number, failed: number): ToolRunOutcome | null {
    if (done + failed === 0) return null;
    if (failed === 0) return "success";
    return done === 0 ? "error" : "partial";
}
