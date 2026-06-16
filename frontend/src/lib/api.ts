/**
 * Central API client for PrivaTools.
 * All tool UIs use these helpers to communicate with the FastAPI backend.
 */

const API_BASE = "/api";

/** Strip an accidental leading "/api" so callers can pass either "/foo" or
 *  "/api/foo" without producing "/api/api/foo". A few tool files have done
 *  the latter historically and that produced 405s in prod. */
function normalizeEndpoint(ep: string): string {
    if (ep.startsWith("/api/")) return ep.slice(4);
    if (ep === "/api") return "/";
    return ep.startsWith("/") ? ep : "/" + ep;
}

/** Turn a Response into a human-readable error message. Distinguishes
 *  HTTP status families so the UI can show meaningful guidance instead of
 *  a generic "Request failed (500)".
 *
 *  Tags `__status` and `__requestId` (when the X-Request-ID header is
 *  present) onto the Error so retry / copy-error UIs can read them. */
async function describeError(res: Response): Promise<Error> {
    const status = res.status;
    const requestId = res.headers.get("x-request-id") || res.headers.get("X-Request-ID") || undefined;
    let detail: string | undefined;
    try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            const body = await res.json();
            if (typeof body.detail === "string") detail = body.detail;
            else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ");
        }
    } catch { /* fall through */ }

    let message: string;
    if (detail) message = detail;
    else if (status === 0 || status >= 502) message = "The server isn't responding right now. Check your connection and try again in a moment.";
    else if (status === 413) message = "That file is too large. The maximum is 500 MB per file.";
    else if (status === 415) message = "That file type isn't supported by this tool.";
    else if (status === 429) message = "Slow down — we're rate-limiting requests. Wait a moment and try again.";
    else if (status === 504) message = "Processing timed out. Try a smaller file or a lighter compression setting.";
    else if (status === 422) message = "Some required field is missing or has an invalid value.";
    else if (status >= 400 && status < 500) message = `Request rejected (HTTP ${status}). Try a different file or adjust the settings.`;
    else message = `Server error (HTTP ${status}). Try again.`;

    const err = new Error(message) as Error & { __status?: number; __requestId?: string };
    err.__status = status;
    if (requestId) err.__requestId = requestId;
    return err;
}

/** Read a request ID off an error (if one was attached by describeError).
 *  The "Copy error" button uses this to build a paste-into-GitHub blob. */
export function getRequestId(err: unknown): string | undefined {
    if (err && typeof err === "object" && "__requestId" in err) {
        const id = (err as { __requestId?: unknown }).__requestId;
        return typeof id === "string" ? id : undefined;
    }
    return undefined;
}

/** Read the HTTP status off an error (if one was attached). */
export function getErrorStatus(err: unknown): number | undefined {
    if (err && typeof err === "object" && "__status" in err) {
        const s = (err as { __status?: unknown }).__status;
        return typeof s === "number" ? s : undefined;
    }
    return undefined;
}

/** Build a clipboard-friendly bug report blob from an error. Includes the
 *  message, request ID, status, URL/User-Agent, and timestamp. Used by the
 *  "Copy error" button on every error panel. */
export function formatErrorForClipboard(err: unknown, context?: string): string {
    const lines: string[] = [];
    lines.push("PrivaTools error report");
    lines.push(`Time: ${new Date().toISOString()}`);
    if (context) lines.push(`Context: ${context}`);
    if (typeof window !== "undefined") {
        try { lines.push(`URL: ${window.location.href}`); } catch { /* ignore */ }
        try { lines.push(`User-Agent: ${navigator.userAgent}`); } catch { /* ignore */ }
    }
    const status = getErrorStatus(err);
    if (status !== undefined) lines.push(`HTTP status: ${status}`);
    const rid = getRequestId(err);
    if (rid) lines.push(`Request ID: ${rid}`);
    if (err instanceof Error) {
        lines.push(`Message: ${err.message}`);
        if (err.stack) lines.push(`Stack:\n${err.stack}`);
    } else {
        lines.push(`Error: ${String(err)}`);
    }
    return lines.join("\n");
}

/** Maximum file size: 500 MB per file (24 GB RAM server) */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "500 MB";
/** Soft cap on number of files per multi-file request. Mostly a sanity check —
 *  the backend has its own per-tool limit. */
export const MAX_FILES_PER_REQUEST = 100;

function validateFileSize(file: File) {
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`File "${file.name}" is ${sizeMB} MB — max allowed is 500 MB`);
    }
}

function validateFileCount(files: File[]) {
    if (files.length === 0) {
        throw new Error("Please select at least one file");
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
        throw new Error(`Too many files (${files.length}). Max ${MAX_FILES_PER_REQUEST} per request — split into batches.`);
    }
}

/** Progress callback: phase ("upload" | "download"), percent 0-100 */
export type ProgressCallback = (phase: "upload" | "download", percent: number) => void;

/** Called when a retry is scheduled. `attempt` is the upcoming attempt number
 *  (1-indexed) and `total` is the cap including the original try. So for a
 *  default 2-retry policy on the 1st retry we get (attempt=2, total=3). */
export type RetryCallback = (attempt: number, total: number, err: unknown) => void;

/** Retry policy. Pass to UploadOptions / RequestOptions to override the default. */
export interface RetryPolicy {
    /** How many ADDITIONAL attempts after the first failure (default 2 — so 3 calls total). */
    attempts: number;
    /** Initial backoff in ms; subsequent retries are linearly multiplied (600, 1200, 1800…). */
    backoffMs: number;
    /** Predicate: should this error be retried? Default: network errors + 5xx HTTP.
     *  NEVER returns `true` for AbortError or 4xx — see `defaultShouldRetry`. */
    on?: (err: unknown) => boolean;
}

/** Default retry policy — moderate. 2 retries, 600ms + 1200ms backoff,
 *  retry network errors + 5xx HTTP but never 4xx or aborts. */
export const DEFAULT_RETRY: RetryPolicy = {
    attempts: 2,
    backoffMs: 600,
    on: defaultShouldRetry,
};

/** Default request timeout — 60s. Server-side processing of ~50MB files
 *  typically finishes in <15s, so 60s catches everything except the truly
 *  pathological. Long-running tools (large compress, OCR) override per-call. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Decide whether an error from a single attempt should be retried.
 *
 * Retry:  network errors, "Failed to fetch", HTTP 5xx (server-side hiccup).
 * Don't:  AbortError (user cancelled), 4xx (caller's fault — bad input).
 *
 * The "retry" classifier is matched against either the Error message OR a
 * special `__status` property we tag onto thrown errors below.
 */
export function defaultShouldRetry(err: unknown): boolean {
    if (isAbortError(err)) return false;
    if (err instanceof Error) {
        // Tag we set on describeError() — see below.
        const status = (err as Error & { __status?: number }).__status;
        if (typeof status === "number") {
            if (status >= 500 && status < 600) return true;
            return false;  // 4xx → don't retry
        }
        const m = err.message.toLowerCase();
        if (m.includes("network") || m.includes("failed to fetch") || m === "load failed") return true;
        if (m.includes("timeout") || m.includes("timed out")) return true;
    }
    return false;
}

/** Shared options for uploads. Adding fields here propagates to every helper. */
export interface UploadOptions {
    /** Forward an AbortController.signal so callers can cancel in-flight uploads
     *  (e.g. PipelinePage's "Cancel" button). XHR-based progress uploads use
     *  xhr.abort() under the hood. */
    signal?: AbortSignal;
    /** Progress callback. Only fires when XHR is used (not for the simple
     *  fetch() path; fetch doesn't expose upload progress). */
    onProgress?: ProgressCallback;
    /** Auto-retry on transient failures. Set `attempts: 0` to disable. */
    retry?: RetryPolicy;
    /** Fired before each retry — lets the UI show "Retrying… (attempt 2 of 3)". */
    onRetry?: RetryCallback;
    /** Per-request timeout in ms. Default 60_000. Pass 0 to disable. */
    timeoutMs?: number;
}

/** Sleep for `ms` milliseconds, but bail out early if the AbortSignal fires.
 *  Returns a promise that rejects with AbortError on cancel. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
        const t = window.setTimeout(() => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
}

/** Wrap a function that returns a Response/Promise in a retry loop following
 *  the supplied policy. On retry, calls `onRetry` and waits `backoffMs * n`
 *  ms before re-invoking. Bubbles up the final error unchanged. */
async function withRetry<T>(
    fn: () => Promise<T>,
    policy: RetryPolicy | undefined,
    onRetry: RetryCallback | undefined,
    signal: AbortSignal | undefined,
): Promise<T> {
    const eff = policy ?? DEFAULT_RETRY;
    const attempts = Math.max(0, eff.attempts | 0);
    const should = eff.on ?? defaultShouldRetry;
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i === attempts) throw err;
            if (signal?.aborted || isAbortError(err)) throw err;
            if (!should(err)) throw err;
            const wait = eff.backoffMs * (i + 1);
            onRetry?.(i + 2, attempts + 1, err);
            try {
                await delay(wait, signal);
            } catch {
                throw err;  // abort during backoff → bail with original error
            }
        }
    }
    throw lastErr;
}

/** Compose an AbortSignal that aborts when the timeout fires OR when the
 *  caller's signal aborts. Returns the combined signal + a cancel fn.
 *  If `timeoutMs === 0`, no timeout is applied — just forwards `external`. */
function timeoutSignal(timeoutMs: number, external?: AbortSignal): {
    signal: AbortSignal | undefined;
    cancel: () => void;
} {
    if (timeoutMs <= 0 && !external) return { signal: undefined, cancel: () => {} };
    const controller = new AbortController();
    let timer: number | null = null;
    const onExternal = () => controller.abort(external?.reason);
    if (external) {
        if (external.aborted) controller.abort(external.reason);
        else external.addEventListener("abort", onExternal, { once: true });
    }
    if (timeoutMs > 0) {
        timer = window.setTimeout(() => {
            // Distinct error so the catch layer can convert into a friendly message.
            const err = new DOMException("Request timed out", "TimeoutError");
            controller.abort(err);
        }, timeoutMs);
    }
    return {
        signal: controller.signal,
        cancel: () => {
            if (timer !== null) window.clearTimeout(timer);
            if (external) external.removeEventListener("abort", onExternal);
        },
    };
}

/** Translate an AbortError that came from our timeoutSignal into a friendly
 *  message. Caller-cancels (which use a plain AbortError) get passed through. */
function decorateTimeoutError(err: unknown): unknown {
    if (err instanceof DOMException && err.name === "TimeoutError") {
        return new Error("The server didn't respond — try a smaller file or check your connection.");
    }
    return err;
}

/** Upload a single file with optional form-data parameters. Returns the response.
 *  Attaches both `file` (singular) and `files` (plural) so the request works
 *  against endpoints that expect either convention — without forcing every UI
 *  to know which name the backend chose. */
export async function uploadFile(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    options?: UploadOptions,
): Promise<Response> {
    validateFileSize(file);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const buildBody = () => {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("files", file);
        if (params) for (const [k, v] of Object.entries(params)) fd.append(k, String(v));
        return fd;
    };
    return withRetry(async () => {
        const { signal: combined, cancel } = timeoutSignal(timeoutMs, options?.signal);
        try {
            const res = await fetch(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
                method: "POST",
                body: buildBody(),
                signal: combined,
            });
            if (!res.ok) throw await describeError(res);
            return res;
        } catch (err) {
            throw decorateTimeoutError(err);
        } finally {
            cancel();
        }
    }, options?.retry, options?.onRetry, options?.signal);
}

/**
 * Upload a single file with real upload progress via XMLHttpRequest.
 * Falls back to fetch() if XHR is unavailable.
 */
export function uploadFileWithProgress(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
): Promise<Response> {
    validateFileSize(file);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("files", file);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            fd.append(k, String(v));
        }
    }

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}${normalizeEndpoint(endpoint)}`);
        xhr.responseType = "blob";

        // Wire abort signal → xhr.abort(). The listener is removed in
        // onloadend so we don't keep a reference to a long-lived signal.
        const onAbort = () => xhr.abort();
        if (signal) signal.addEventListener("abort", onAbort);
        xhr.onloadend = () => { if (signal) signal.removeEventListener("abort", onAbort); };

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress("upload", Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const blob = xhr.response as Blob;
                const headers = new Headers();
                xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
                    const parts = line.split(": ");
                    if (parts.length === 2) headers.append(parts[0], parts[1]);
                });
                resolve(new Response(blob, { status: xhr.status, headers }));
            } else {
                const blob = xhr.response as Blob;
                const headers = new Headers();
                xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
                    const parts = line.split(": ");
                    if (parts.length === 2) headers.append(parts[0], parts[1]);
                });
                describeError(new Response(blob, { status: xhr.status, headers }))
                    .then(reject)
                    .catch(() => reject(new Error(`Request failed (${xhr.status})`)));
            }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.onabort  = () => reject(new DOMException("Aborted", "AbortError"));
        xhr.ontimeout = () => reject(new Error("Request timed out"));
        xhr.timeout = 300_000; // 5 min
        xhr.send(fd);
    });
}

/** Upload multiple files with optional params. Returns the response. */
export async function uploadFiles(
    endpoint: string,
    files: File[],
    params?: Record<string, string | number | boolean>,
    options?: UploadOptions,
): Promise<Response> {
    validateFileCount(files);
    for (const f of files) validateFileSize(f);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const buildBody = () => {
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        if (params) for (const [k, v] of Object.entries(params)) fd.append(k, String(v));
        return fd;
    };
    return withRetry(async () => {
        const { signal: combined, cancel } = timeoutSignal(timeoutMs, options?.signal);
        try {
            const res = await fetch(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
                method: "POST",
                body: buildBody(),
                signal: combined,
            });
            if (!res.ok) throw await describeError(res);
            return res;
        } catch (err) {
            throw decorateTimeoutError(err);
        } finally {
            cancel();
        }
    }, options?.retry, options?.onRetry, options?.signal);
}

/**
 * Upload multiple files with real upload progress via XMLHttpRequest.
 */
export function uploadFilesWithProgress(
    endpoint: string,
    files: File[],
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
): Promise<Response> {
    validateFileCount(files);
    for (const f of files) validateFileSize(f);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            fd.append(k, String(v));
        }
    }

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}${normalizeEndpoint(endpoint)}`);
        xhr.responseType = "blob";

        const onAbort = () => xhr.abort();
        if (signal) signal.addEventListener("abort", onAbort);
        xhr.onloadend = () => { if (signal) signal.removeEventListener("abort", onAbort); };

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress("upload", Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const blob = xhr.response as Blob;
                const headers = new Headers();
                xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
                    const parts = line.split(": ");
                    if (parts.length === 2) headers.append(parts[0], parts[1]);
                });
                resolve(new Response(blob, { status: xhr.status, headers }));
            } else {
                const blob = xhr.response as Blob;
                const headers = new Headers();
                xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
                    const parts = line.split(": ");
                    if (parts.length === 2) headers.append(parts[0], parts[1]);
                });
                describeError(new Response(blob, { status: xhr.status, headers }))
                    .then(reject)
                    .catch(() => reject(new Error(`Request failed (${xhr.status})`)));
            }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.onabort  = () => reject(new DOMException("Aborted", "AbortError"));
        xhr.ontimeout = () => reject(new Error("Request timed out"));
        xhr.timeout = 300_000;
        xhr.send(fd);
    });
}

/** Upload a file and get a JSON response back. */
export async function uploadFileGetJson<T = unknown>(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    options?: UploadOptions,
): Promise<T> {
    const res = await uploadFile(endpoint, file, params, options);
    return res.json() as Promise<T>;
}

/** Options for non-file POST helpers — same retry/timeout knobs as uploads. */
export interface RequestOptions {
    signal?: AbortSignal;
    retry?: RetryPolicy;
    onRetry?: RetryCallback;
    timeoutMs?: number;
}

/** Post form data (no file) and get JSON back. */
export async function postForm<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
    options?: RequestOptions,
): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const buildBody = () => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(params)) fd.append(k, String(v));
        return fd;
    };
    return withRetry(async () => {
        const { signal: combined, cancel } = timeoutSignal(timeoutMs, options?.signal);
        try {
            const res = await fetch(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
                method: "POST",
                body: buildBody(),
                signal: combined,
            });
            if (!res.ok) throw await describeError(res);
            return res.json() as Promise<T>;
        } catch (err) {
            throw decorateTimeoutError(err);
        } finally {
            cancel();
        }
    }, options?.retry, options?.onRetry, options?.signal);
}

/** Post JSON body and get JSON back. */
export async function postJson<T = unknown>(
    endpoint: string,
    body: unknown,
    options?: RequestOptions,
): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const serialised = JSON.stringify(body);
    return withRetry(async () => {
        const { signal: combined, cancel } = timeoutSignal(timeoutMs, options?.signal);
        try {
            const res = await fetch(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: serialised,
                signal: combined,
            });
            if (!res.ok) throw await describeError(res);
            return res.json() as Promise<T>;
        } catch (err) {
            throw decorateTimeoutError(err);
        } finally {
            cancel();
        }
    }, options?.retry, options?.onRetry, options?.signal);
}

/** Trigger a browser download from a blob. */
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);

    // Show toast notification
    import("sonner").then(({ toast }) => {
        toast.success("Downloaded!", { description: filename, duration: 3000 });
    }).catch(() => { });
}

/** Helper: upload file → get blob → download. With progress tracking & abort.
 *
 *  Accepts optional `options` (retry/timeout/onRetry) — when supplied, the
 *  underlying uploadFile() inherits the same policy. */
export async function processAndDownload(
    endpoint: string,
    file: File,
    filename: string,
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
    options?: { retry?: RetryPolicy; onRetry?: RetryCallback; timeoutMs?: number },
): Promise<Record<string, string>> {
    const res = onProgress
        ? await uploadFileWithProgress(endpoint, file, params, onProgress, signal)
        : await uploadFile(endpoint, file, params, {
            signal,
            retry: options?.retry,
            onRetry: options?.onRetry,
            timeoutMs: options?.timeoutMs,
        });
    if (onProgress) onProgress("download", 50);
    const blob = await res.blob();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (onProgress) onProgress("download", 100);
    // Prefer server-supplied filename when present — the backend often returns
    // a Content-Disposition with the "correct" name (e.g. timestamped, with
    // suffix), and using it avoids the caller having to second-guess.
    const finalName = filenameFromResponse(res) || filename;
    downloadBlob(blob, finalName);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return headers;
}

/** Helper: upload multiple files → get blob → download. With progress tracking. */
export async function processFilesAndDownload(
    endpoint: string,
    files: File[],
    filename: string,
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
    options?: { retry?: RetryPolicy; onRetry?: RetryCallback; timeoutMs?: number },
): Promise<void> {
    const res = onProgress
        ? await uploadFilesWithProgress(endpoint, files, params, onProgress, signal)
        : await uploadFiles(endpoint, files, params, {
            signal,
            retry: options?.retry,
            onRetry: options?.onRetry,
            timeoutMs: options?.timeoutMs,
        });
    if (onProgress) onProgress("download", 50);
    const blob = await res.blob();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (onProgress) onProgress("download", 100);
    const finalName = filenameFromResponse(res) || filename;
    downloadBlob(blob, finalName);
}

/** Extract the filename from a response's Content-Disposition header.
 *  Returns null if absent or unparseable. Honors RFC 5987 `filename*=UTF-8''…`. */
function filenameFromResponse(res: Response): string | null {
    const cd = res.headers.get("Content-Disposition");
    if (!cd) return null;
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try { return decodeURIComponent(utf8Match[1].trim()); }
        catch { return utf8Match[1].trim(); }
    }
    const ascii = cd.match(/filename=(["']?)([^"';]+)\1/i);
    return ascii?.[2]?.trim() || null;
}

/** Build an output filename that preserves the user's original filename stem.
 *
 *   buildOutputFilename("report.pdf",       "compressed", "pdf") → "report_compressed.pdf"
 *   buildOutputFilename("vacation.jpg",     null,         "png") → "vacation.png"
 *   buildOutputFilename("clip.mp4",         "audio",      "mp3") → "clip_audio.mp3"
 *   buildOutputFilename(undefined,          "merged",     "pdf") → "merged.pdf"
 *
 * Pass `suffix=null` for pure format conversions (e.g. jpg→png) so the
 * downloaded file just changes extension. Pass a verb suffix for any
 * operation that modifies content (compress, rotate, watermark, etc.).
 */
export function buildOutputFilename(
    sourceName: string | null | undefined,
    suffix: string | null,
    ext: string,
): string {
    const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
    if (!sourceName) {
        return `${suffix || "output"}.${cleanExt}`;
    }
    const lastDot = sourceName.lastIndexOf(".");
    const stem = lastDot > 0 ? sourceName.substring(0, lastDot) : sourceName;
    if (suffix) return `${stem}_${suffix}.${cleanExt}`;
    return `${stem}.${cleanExt}`;
}

/** Format bytes to human-readable string. */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
}

/** True iff the error originates from a user-initiated abort. Tool UIs use
 *  this to suppress a misleading "request failed" toast when the user just
 *  cancelled. */
export function isAbortError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof DOMException && err.name === "AbortError") return true;
    if (err instanceof Error && err.name === "AbortError") return true;
    return false;
}
