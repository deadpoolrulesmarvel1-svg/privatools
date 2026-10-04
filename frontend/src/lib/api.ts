/**
 * Central API client for PrivaTools.
 * All tool UIs use these helpers to communicate with the FastAPI backend.
 */
import { toast } from "sonner";
import type { ToolErrorKind } from "./toolRun";
import { uploadFieldFor } from "./upload-fields";

/**
 * Resolve the origin API requests are sent to. Priority:
 *   1. Runtime `<meta name="privatools:api-base">` injected into index.html by
 *      the backend when PUBLIC_API_BASE_URL is set (the api-subdomain split).
 *      Lets one built bundle serve same-origin OR cross-origin with no rebuild.
 *   2. Build-time `VITE_API_URL` (explicit builds / older config).
 *   3. Same-origin (empty string) — the default for dev and current prod.
 * Exported for unit testing; callers use the derived API_BASE / apiUrl().
 */
export function resolveApiOrigin(): string {
    if (typeof document !== "undefined") {
        const fromMeta = document
            .querySelector('meta[name="privatools:api-base"]')
            ?.getAttribute("content")
            ?.trim();
        if (fromMeta) return fromMeta.replace(/\/$/, "");
    }
    return (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
}

const API_ORIGIN = resolveApiOrigin();
const API_BASE = `${API_ORIGIN}/api`;

/** Strip an accidental leading "/api" so callers can pass either "/foo" or
 *  "/api/foo" without producing "/api/api/foo". A few tool files have done
 *  the latter historically and that produced 405s in prod. */
function normalizeEndpoint(ep: string): string {
    if (ep.startsWith("/api/")) return ep.slice(4);
    if (ep === "/api") return "/";
    return ep.startsWith("/") ? ep : "/" + ep;
}

/** Absolute URL for an API endpoint, honoring the configured API origin
 *  (same-origin by default, or the api-subdomain when the split is active).
 *  Use this anywhere a raw `fetch` would otherwise hardcode "/api/...". */
export function apiUrl(endpoint: string): string {
    return `${API_BASE}${normalizeEndpoint(endpoint)}`;
}

/** Turn a Response into a human-readable error message. Distinguishes
 *  HTTP status families so the UI can show meaningful guidance instead of
 *  a generic "Request failed (500)".
 *
 *  Tags `__status`, `__requestId` (when the X-Request-ID header is present)
 *  and `__detail` (when the server gave a JSON detail) onto the Error so
 *  retry / copy-error UIs can read them. */
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
    else if (status === 504 || status === 524) message = "Processing timed out. Try a smaller file or a lighter compression setting.";
    else if (status === 0) message = "The server isn't responding right now. Check your connection and try again in a moment.";
    else if (status >= 502) message = "The server isn't responding right now. Try again in a moment.";
    else if (status === 413) message = "That upload is too large. The maximum is 500 MB per upload.";
    else if (status === 415) message = "That file type isn't supported by this tool.";
    else if (status === 429) message = "Slow down — we're rate-limiting requests. Wait a moment and try again.";
    else if (status === 422) message = "Some required field is missing or has an invalid value.";
    else if (status >= 400 && status < 500) message = `Request rejected (HTTP ${status}). Try a different file or adjust the settings.`;
    else message = `Server error (HTTP ${status}). Try again.`;

    const err = new Error(message) as Error & { __status?: number; __requestId?: string; __detail?: string };
    err.__status = status;
    if (requestId) err.__requestId = requestId;
    if (detail) err.__detail = detail;
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

/** The server's own words for a failed request (its JSON `detail`), if it gave
 *  any: unlike the message, never one written here for a bare status code. */
export function getErrorDetail(err: unknown): string | undefined {
    if (err && typeof err === "object" && "__detail" in err) {
        const detail = (err as { __detail?: unknown }).__detail;
        return typeof detail === "string" ? detail : undefined;
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

/** Tag an error with the fixed category usage analytics reports for a failed
 *  run (see `toolErrorKind` in toolRun.ts). HTTP errors carry `__status`
 *  instead; this marks failures that have none. Returns the same error. */
export function withErrorKind<T>(err: T, kind: ToolErrorKind): T {
    if (err && typeof err === "object") (err as { __kind?: ToolErrorKind }).__kind = kind;
    return err;
}

/** Mark an error whose message is already written for the person using the
 *  tool, so shared engines show it as it is instead of passing it through
 *  `friendlyError`, whose rewrites assume a PDF (it would call a damaged
 *  image a damaged PDF). Returns the same error. */
export function withUserMessage<T>(err: T): T {
    if (err && typeof err === "object") (err as { __userMessage?: boolean }).__userMessage = true;
    return err;
}

export function hasUserMessage(err: unknown): err is Error {
    return err instanceof Error && (err as { __userMessage?: unknown }).__userMessage === true;
}

/** Read a JSON response body. A body that is not valid JSON (a proxy's HTML
 *  error page, a truncated answer) is the server's failure, so it is tagged
 *  `server`; anything else, such as a dropped connection, passes through. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
    try {
        return await res.json() as T;
    } catch (err) {
        throw err instanceof SyntaxError ? withErrorKind(err, "server") : err;
    }
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
/**
 * What the PrivaTools server takes from Audio Converter, Extract Audio and
 * Cut / Trim Video & Audio: 200 MB (max_bytes in phase6_tools.py's
 * audio_converter, MAX_VIDEO_SIZE in non_pdf_tools.py), less than the
 * MAX_FILE_SIZE a page takes. For pages that send a file on to one of them.
 */
export const SERVER_MEDIA_MAX = 200 * 1024 * 1024;
export const SERVER_MEDIA_MAX_LABEL = "200 MB";
/** Soft cap on number of files per multi-file request. Mostly a sanity check —
 *  the backend has its own per-tool limit. */
export const MAX_FILES_PER_REQUEST = 100;

/** The most one request can carry. Production nginx (client_max_body_size
 *  500M) and the backend (MAX_UPLOAD_MB) both count the whole multipart body,
 *  every file and field in it, so files that add up to 500 MB do not fit. */
export const MAX_REQUEST_SIZE = 500 * 1024 * 1024;
export const MAX_REQUEST_SIZE_LABEL = "500 MB";

/** What a multipart body adds for each part besides its content: the boundary
 *  line and the part's headers. Generous on purpose: a boundary can run to 70
 *  characters, and a file's name goes in its headers, percent-escaped where
 *  it needs to be. */
const PART_OVERHEAD = 1024;
const utf8 = new TextEncoder();

/** At most how large a request carrying these form values comes to. */
export function requestSize(values: Iterable<FormDataEntryValue>): number {
    let size = PART_OVERHEAD; // the closing boundary
    for (const value of values) {
        size += PART_OVERHEAD + (typeof value === "string" ? utf8.encode(value).length : value.size);
    }
    return size;
}

/** An upload that fails is sent again only up to this size. Another attempt
 *  sends the whole body again, and past this it costs the visitor minutes on a
 *  slow connection. A failure is rarely a blip the retry's second or two of
 *  backoff would outlast: a proxy that refuses large bodies refuses every
 *  attempt; over HTTP/2 Chrome has already sent a stalled upload again itself
 *  before reporting a network error; and while the app is down, nginx refuses
 *  the upload's CORS preflight (a network error) or, when the browser still
 *  holds a preflight, buffers the whole upload before answering 502. So a
 *  larger failure is shown at once, and the visitor decides whether to send it
 *  again. */
export const MAX_RETRY_SIZE = 10 * 1024 * 1024;

function validateFileSize(file: File) {
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        throw withErrorKind(new Error(`File "${file.name}" is ${sizeMB} MB — max allowed is 500 MB`), "too_large");
    }
}

function validateFileCount(files: File[]) {
    if (files.length === 0) {
        throw withErrorKind(new Error("Please select at least one file"), "bad_input");
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
        throw withErrorKind(new Error(`Too many files (${files.length}). Max ${MAX_FILES_PER_REQUEST} per request — split into batches.`), "bad_input");
    }
}

function validateFormDataFiles(fd: FormData) {
    for (const value of fd.values()) {
        if (value instanceof File) validateFileSize(value);
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
    /** Predicate: should this error be retried? Default: network errors + 5xx HTTP
     *  other than a timeout. NEVER returns `true` for AbortError, 4xx, a
     *  timeout or an upload over MAX_RETRY_SIZE — see `defaultShouldRetry`. */
    on?: (err: unknown) => boolean;
}

/** Default retry policy — moderate. 2 retries, 600ms + 1200ms backoff,
 *  retry network errors + 5xx HTTP but never 4xx, timeouts, aborts or an
 *  upload over MAX_RETRY_SIZE. */
export const DEFAULT_RETRY: RetryPolicy = {
    attempts: 2,
    backoffMs: 600,
    on: defaultShouldRetry,
};

/** The server's own limit on one request, counted once the whole upload has
 *  reached it. The backend answers 504 when REQUEST_TIMEOUT_SECONDS (300 in
 *  docker-compose.yml) have passed, and production nginx, which receives the
 *  whole upload before it hands the request on, waits proxy_read_timeout 300s
 *  for the backend. nginx sets no limit on how long a moving upload takes; it
 *  drops only one that sends nothing for client_body_timeout 300s. */
export const SERVER_TIME_LIMIT_MS = 300_000;

/** How long a request may go with nothing happening before the page gives up
 *  on it: no upload progress while a file is being sent, no answer once the
 *  last byte has gone, no bytes while the answer arrives. It is a minute longer
 *  than the server's own limit, so the server's answer, a 504 included,
 *  normally comes first. It may not when something between the browser and
 *  the server holds the upload after the browser has sent it, such as a
 *  corporate proxy that scans uploads, for more than that minute: the
 *  server's clock starts only once the whole body has reached it.
 *
 *  What this deadline guarantees: it never ends an upload that keeps moving,
 *  however long that takes. What it cannot guarantee: that the browser or the
 *  network will not end one. Over HTTP/2, Chrome closes a connection whose
 *  PING goes unanswered for 10 s, which happens when the PING queues behind
 *  upload bytes on a slow, deeply buffered uplink. It then sends the upload
 *  again from the start, and once its own retries run out the request fails
 *  as a network error.
 *
 *  A request without a file cannot report upload progress, so for it the
 *  wait runs from the start. */
export const DEFAULT_TIMEOUT_MS = SERVER_TIME_LIMIT_MS + 60_000;

/** Decide whether an error from a single attempt should be retried.
 *
 * Retry:  network errors, "Failed to fetch", HTTP 5xx (server-side hiccup).
 * Don't:  AbortError (user cancelled), 4xx (caller's fault — bad input), and a
 *         timeout: 504 or 524 from the server, or the page's own deadline.
 *         Each of those came after a full wait, which another attempt would
 *         repeat, sending the whole upload again. Nor any failure of an upload
 *         over MAX_RETRY_SIZE, which another attempt would send all over again.
 *
 * The "retry" classifier is matched against either the Error message OR a
 * special `__status` property we tag onto thrown errors below.
 */
export function defaultShouldRetry(err: unknown): boolean {
    if (isAbortError(err)) return false;
    if (err instanceof Error) {
        if ((err as Error & { __kind?: ToolErrorKind }).__kind === "timeout") return false;
        if (((err as Error & { __requestSize?: number }).__requestSize ?? 0) > MAX_RETRY_SIZE) return false;
        // Tag we set on describeError() — see below.
        const status = (err as Error & { __status?: number }).__status;
        if (typeof status === "number") {
            if (status === 504 || status === 524) return false;
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
     *  (e.g. PipelinePage's "Cancel" button). Uploads go by XMLHttpRequest and
     *  are cancelled with xhr.abort(). */
    signal?: AbortSignal;
    /** Upload progress, as a percentage of the request body sent. */
    onProgress?: ProgressCallback;
    /** Auto-retry on transient failures. Set `attempts: 0` to disable. */
    retry?: RetryPolicy;
    /** Fired before each retry — lets the UI show "Retrying… (attempt 2 of 3)". */
    onRetry?: RetryCallback;
    /** How long the request may go with nothing happening before the page
     *  gives up. Default DEFAULT_TIMEOUT_MS; 0 turns the deadline off. Leave it
     *  unset: a shorter wait gives up before the server's own limit. */
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

/** What the page says when it gives up, by what it was waiting for. */
const GAVE_UP = {
    upload: "The upload stopped moving — check your connection and try again.",
    answer: "The server didn't respond — try a smaller file or check your connection.",
    download: "The result stopped arriving — check your connection and try again.",
} as const;
type RequestStage = keyof typeof GAVE_UP;

function gaveUp(stage: RequestStage): Error {
    return withErrorKind(new Error(GAVE_UP[stage]), "timeout");
}

/** Translate an AbortError that came from our timeoutSignal into a friendly
 *  message, and mark a request that never completed. Caller-cancels (which use
 *  a plain AbortError) and HTTP errors get passed through. */
function decorateTransportError(err: unknown): unknown {
    if (err instanceof DOMException && err.name === "TimeoutError") return gaveUp("answer");
    // Only fetch() itself can throw a TypeError inside the helpers' try blocks:
    // offline, DNS, a dropped connection, CORS or a blocked request.
    if (err instanceof TypeError) return withErrorKind(err, "network");
    return err;
}

/** The error for a form that would pass MAX_REQUEST_SIZE. It is refused before
 *  anything is sent: nginx would refuse it only once the upload had begun. The
 *  limit counts the form the files go in, so the message says so: shown only
 *  the files' size, a visitor refused at "500.0 MB" would see no reason. */
function tooLargeToSend(body: FormData): Error {
    const files = [...body.values()].filter((value): value is File => typeof value !== "string");
    const size = formatFileSize(files.reduce((sum, file) => sum + file.size, 0));
    const message = files.length > 1
        ? `These files are ${size} in all, and one upload can carry ${MAX_REQUEST_SIZE_LABEL}, counting the form they are sent in. Nothing was sent. Choose fewer or smaller files.`
        : `This file is ${size}, and one upload can carry ${MAX_REQUEST_SIZE_LABEL}, counting the form it is sent in. Nothing was sent. Choose a smaller file.`;
    return withErrorKind(new Error(message), "too_large");
}

/** Note on a failed upload how large it was, for defaultShouldRetry. */
function withRequestSize<T>(err: T, size: number): T {
    if (err && typeof err === "object") (err as { __requestSize?: number }).__requestSize = size;
    return err;
}

/** True when a form carries a file, whose upload can take minutes. */
function carriesFile(body: FormData): boolean {
    for (const value of body.values()) if (typeof value !== "string") return true;
    return false;
}

/** The headers an XMLHttpRequest received. A value can itself contain ": ",
 *  as Redact's JSON report does, so each line is split at its first colon. */
function xhrHeaders(xhr: XMLHttpRequest): Headers {
    const headers = new Headers();
    for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        try {
            headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        } catch { /* a header the Headers class refuses: skip it */ }
    }
    return headers;
}

/** Send a form that carries a file and resolve with the answer, as a fetch()
 *  Response. It goes by XMLHttpRequest because only that reports upload
 *  progress, which is how a slow upload that is still moving is told apart
 *  from a connection that has died.
 *
 *  The deadline restarts whenever something happens: a chunk of the upload
 *  goes out, the answer's headers come in, a chunk of the answer comes in. So
 *  once the last byte has gone, the page waits `timeoutMs` for the answer,
 *  which is the server's own limit plus a minute by default, and the page
 *  gives up on an upload only once it has not moved for that long (the
 *  browser can still end one itself; see DEFAULT_TIMEOUT_MS). The request
 *  then fails as a timeout; `timeoutMs` 0 turns the deadline off. A cancel
 *  through `signal` rejects with an AbortError.
 *
 *  A form over MAX_REQUEST_SIZE is refused before anything is sent. */
function sendForm(
    endpoint: string,
    body: FormData,
    { signal, onProgress, timeoutMs }: { signal?: AbortSignal; onProgress?: ProgressCallback; timeoutMs: number },
): Promise<Response> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const size = requestSize(body.values());
        if (size > MAX_REQUEST_SIZE) {
            reject(tooLargeToSend(body));
            return;
        }
        const failed = (err: unknown) => reject(withRequestSize(err, size));
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}${normalizeEndpoint(endpoint)}`);
        xhr.responseType = "blob";

        let stage: RequestStage = "upload";
        let expired: RequestStage | null = null;
        let timer: number | undefined;
        const moved = () => {
            window.clearTimeout(timer);
            if (timeoutMs > 0) timer = window.setTimeout(() => { expired = stage; xhr.abort(); }, timeoutMs);
        };

        // Wire abort signal → xhr.abort(). The listener is removed in
        // onloadend so we don't keep a reference to a long-lived signal.
        const onAbort = () => xhr.abort();
        if (signal) signal.addEventListener("abort", onAbort);
        xhr.onloadend = () => {
            window.clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", onAbort);
        };

        // Upload listeners are what make the browser report upload progress.
        // (For a cross-origin API host they also make it send a CORS preflight.)
        xhr.upload.onprogress = (e) => {
            moved();
            if (e.lengthComputable && e.total > 0 && onProgress) {
                onProgress("upload", Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.upload.onload = () => {
            // The last byte has gone, so the server's own limit is running now.
            if (stage === "upload") stage = "answer";
            moved();
        };
        xhr.onreadystatechange = () => {
            // HEADERS_RECEIVED or LOADING: the answer is coming in.
            if (xhr.readyState === 2 || xhr.readyState === 3) {
                stage = "download";
                moved();
            }
        };
        xhr.onprogress = moved;

        xhr.onload = () => {
            let res: Response;
            try {
                // 204, 205 and 304 answers cannot carry a body.
                const bodyless = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
                res = new Response(bodyless ? null : xhr.response as Blob, { status: xhr.status, headers: xhrHeaders(xhr) });
            } catch {
                reject(withErrorKind(new Error(`Request failed (${xhr.status})`), "server"));
                return;
            }
            if (res.ok) resolve(res);
            else describeError(res).then(failed, failed);
        };
        xhr.onerror = () => failed(withErrorKind(new Error("Network error"), "network"));
        xhr.onabort = () => reject(expired ? gaveUp(expired) : new DOMException("Aborted", "AbortError"));
        // xhr.timeout, a limit on the whole request upload included, stays 0
        // (none); settle anyway should a browser ever fire it.
        xhr.ontimeout = () => reject(gaveUp(stage));
        moved();
        xhr.send(body);
    });
}

/** Upload a single file with optional form-data parameters. Returns the response.
 *  The file goes once, under the field its route reads (`file`, or `files` for
 *  the routes listed in upload-fields.ts), so UIs never need to know which. */
export async function uploadFile(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    options?: UploadOptions,
): Promise<Response> {
    validateFileSize(file);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const field = uploadFieldFor(endpoint);
    const buildBody = () => {
        const fd = new FormData();
        fd.append(field, file);
        if (params) for (const [k, v] of Object.entries(params)) fd.append(k, String(v));
        return fd;
    };
    return withRetry(
        () => sendForm(endpoint, buildBody(), { signal: options?.signal, onProgress: options?.onProgress, timeoutMs }),
        options?.retry, options?.onRetry, options?.signal,
    );
}

/**
 * Upload a single file, reporting its upload progress. Like uploadFile, it
 * sends the file once, under the field its route reads, and waits by the same
 * rule; unlike it, it does not retry.
 */
export function uploadFileWithProgress(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
    options?: { timeoutMs?: number },
): Promise<Response> {
    validateFileSize(file);
    const fd = new FormData();
    fd.append(uploadFieldFor(endpoint), file);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            fd.append(k, String(v));
        }
    }
    return sendForm(endpoint, fd, { signal, onProgress, timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS });
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
    return withRetry(
        () => sendForm(endpoint, buildBody(), { signal: options?.signal, onProgress: options?.onProgress, timeoutMs }),
        options?.retry, options?.onRetry, options?.signal,
    );
}

/**
 * Upload multiple files, reporting their upload progress. Waits by the same
 * rule as uploadFiles, without retrying.
 */
export function uploadFilesWithProgress(
    endpoint: string,
    files: File[],
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
    options?: { timeoutMs?: number },
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
    return sendForm(endpoint, fd, { signal, onProgress, timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS });
}

/** Upload a file and get a JSON response back. */
export async function uploadFileGetJson<T = unknown>(
    endpoint: string,
    file: File,
    params?: Record<string, string | number | boolean>,
    options?: UploadOptions,
): Promise<T> {
    const res = await uploadFile(endpoint, file, params, options);
    return readJson<T>(res);
}

/** Options for non-file POST helpers — same retry/timeout knobs as uploads. */
export interface RequestOptions {
    signal?: AbortSignal;
    retry?: RetryPolicy;
    onRetry?: RetryCallback;
    /** As UploadOptions.timeoutMs: leave it unset. */
    timeoutMs?: number;
}

/** Post arbitrary FormData and return the raw response.
 *
 * This covers custom workflows (Batch, Pipeline, multi-input editors) that
 * need to build their own payload but still deserve the shared timeout,
 * retry, abort, request-ID, and friendly-error handling used by uploadFile().
 * A form that carries a file is sent as uploadFile() sends one, so a slow
 * upload is waited for; a form without one goes by fetch().
 * Pass a builder when retries are enabled so each attempt gets a fresh body.
 */
export async function postFormData(
    endpoint: string,
    formData: FormData | (() => FormData),
    options?: RequestOptions,
): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const buildBody = typeof formData === "function" ? formData : () => formData;
    return withRetry(async () => {
        const body = buildBody();
        validateFormDataFiles(body);
        if (carriesFile(body)) return sendForm(endpoint, body, { signal: options?.signal, timeoutMs });
        const { signal: combined, cancel } = timeoutSignal(timeoutMs, options?.signal);
        try {
            const res = await fetch(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
                method: "POST",
                body,
                signal: combined,
            });
            if (!res.ok) throw await describeError(res);
            return res;
        } catch (err) {
            throw decorateTransportError(err);
        } finally {
            cancel();
        }
    }, options?.retry, options?.onRetry, options?.signal);
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
            return readJson<T>(res);
        } catch (err) {
            throw decorateTransportError(err);
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
            return readJson<T>(res);
        } catch (err) {
            throw decorateTransportError(err);
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

    toast.success("Downloaded!", { description: filename, duration: 3000 });
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
        ? await uploadFileWithProgress(endpoint, file, params, onProgress, signal, { timeoutMs: options?.timeoutMs })
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
    const finalName = chooseDownloadFilename(filename, filenameFromResponse(res));
    downloadBlob(blob, finalName);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return headers;
}

/** Helper: upload multiple files → get blob → download. With progress tracking.
 *  Returns what it downloaded, so the result can offer "Download again". */
export async function processFilesAndDownload(
    endpoint: string,
    files: File[],
    filename: string,
    params?: Record<string, string | number | boolean>,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
    options?: { retry?: RetryPolicy; onRetry?: RetryCallback; timeoutMs?: number },
): Promise<{ blob: Blob; filename: string }> {
    const res = onProgress
        ? await uploadFilesWithProgress(endpoint, files, params, onProgress, signal, { timeoutMs: options?.timeoutMs })
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
    const finalName = chooseDownloadFilename(filename, filenameFromResponse(res));
    downloadBlob(blob, finalName);
    return { blob, filename: finalName };
}

/** Choose the filename users see in their Downloads folder.
 *
 * The UI usually knows the source filename and passes an original-preserving
 * name like `contract_unlocked.pdf`. Some backend routes still send generic
 * fallbacks like `unlocked.pdf`; those should not clobber the better UI name.
 * Specific backend names still win when they are not generic one-word labels.
 */
export function chooseDownloadFilename(plannedFilename: string, responseFilename: string | null): string {
    if (!responseFilename) return plannedFilename;
    const plannedStem = filenameStem(plannedFilename);
    const responseStem = filenameStem(responseFilename);
    const plannedLower = plannedStem.toLowerCase();
    const responseLower = responseStem.toLowerCase();
    if (!plannedStem || plannedStem === responseStem) return responseFilename;
    if (/^[a-z0-9]+$/i.test(responseStem) && !GENERIC_PLANNED_STEMS.has(plannedLower)) return plannedFilename;

    const sourceHint = plannedLower.split(/[_-]/)[0];
    const hasActionSuffix = plannedLower.includes("_") || plannedLower.includes("-");
    if (
        hasActionSuffix
        && sourceHint.length >= 3
        && !responseLower.includes(sourceHint)
    ) {
        return plannedFilename;
    }
    return responseFilename;
}

function filenameStem(filename: string): string {
    const clean = filename.split(/[\\/]/).pop() || filename;
    const dot = clean.lastIndexOf(".");
    return (dot > 0 ? clean.slice(0, dot) : clean).trim();
}

const GENERIC_PLANNED_STEMS = new Set([
    "archive",
    "converted",
    "document",
    "file",
    "images",
    "output",
    "pages",
    "result",
    "table",
]);

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
