import { afterEach, describe, expect, it } from "vitest";
import { emitToolRun, isTransientFailure, TOOL_ERROR_KINDS, TOOL_RUN_EVENT, toolErrorKind } from "./toolRun";

type Detail = Record<string, unknown>;
const listeners: ((event: Event) => void)[] = [];
function listen(): Detail[] {
    const seen: Detail[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<Detail>).detail);
    listeners.push(listener);
    window.addEventListener(TOOL_RUN_EVENT, listener);
    return seen;
}
afterEach(() => { for (const listener of listeners.splice(0)) window.removeEventListener(TOOL_RUN_EVENT, listener); });

/** The shape api.ts gives an HTTP error: a friendly message plus the status. */
function httpError(status: number, message = "Upload of secret-contract.pdf was rejected") {
    return Object.assign(new Error(message), { __status: status });
}

describe("toolErrorKind", () => {
    it.each([
        [413, "too_large"],
        [429, "rate_limited"],
        [400, "bad_input"],
        [415, "bad_input"],
        [422, "bad_input"],
        [408, "timeout"],
        [504, "timeout"],
        // Cloudflare gives up on the origin after 100 s; nginx allows 300 s.
        [524, "timeout"],
        [520, "server"],
        [500, "server"],
        [502, "server"],
        [503, "server"],
        // A 4xx outside the groups above is not the visitor's input: for a
        // tool route it means the deployment is out of step (404, 405).
        [404, "server"],
        [405, "server"],
    ])("maps HTTP %i to %s", (status, kind) => {
        expect(toolErrorKind(httpError(status))).toBe(kind);
    });

    it("treats a user abort as a cancel, not a failure", () => {
        expect(toolErrorKind(new DOMException("Aborted", "AbortError"))).toBe("cancelled");
        const byokAbort = Object.assign(new Error("aborted"), { name: "ByokError", kind: "Aborted" });
        expect(toolErrorKind(byokAbort)).toBe("cancelled");
    });

    it("reads the category api.ts tags on failures that have no HTTP status", () => {
        for (const kind of TOOL_ERROR_KINDS) expect(toolErrorKind(Object.assign(new Error("x"), { __kind: kind }))).toBe(kind);
        // An unknown tag is ignored rather than trusted.
        expect(toolErrorKind(Object.assign(new Error("x"), { __kind: "secret.pdf is corrupt" }))).toBe("browser");
    });

    it("recognizes a fetch that never completed and a client deadline", () => {
        expect(toolErrorKind(new TypeError("Failed to fetch"))).toBe("network");
        expect(toolErrorKind(new TypeError("NetworkError when attempting to fetch resource."))).toBe("network");
        expect(toolErrorKind(new TypeError("Load failed"))).toBe("network");
        expect(toolErrorKind(new DOMException("Request timed out", "TimeoutError"))).toBe("timeout");
    });

    it("attributes AI provider failures to the provider", () => {
        const rejected = Object.assign(new Error("auth rejected (401)"), { name: "ByokError", kind: "BadKey" });
        expect(toolErrorKind(rejected)).toBe("provider");
    });

    it("calls anything else a browser-side failure", () => {
        expect(toolErrorKind(new TypeError("Cannot read properties of undefined (reading 'pages')"))).toBe("browser");
        expect(toolErrorKind(new Error("The model returned no summary."))).toBe("browser");
        expect(toolErrorKind("worker crashed")).toBe("browser");
    });
});

describe("isTransientFailure", () => {
    it.each([500, 502, 503, 520, 429, 408, 504, 524])("offers another attempt after HTTP %i", status => {
        expect(isTransientFailure(httpError(status))).toBe(true);
    });

    it.each([400, 404, 405, 413, 415, 422])("does not after HTTP %i: the same file would fail the same way", status => {
        expect(isTransientFailure(httpError(status))).toBe(false);
    });

    it("counts a dropped connection, a deadline and an unreadable answer as passing trouble", () => {
        expect(isTransientFailure(new TypeError("Failed to fetch"))).toBe(true);
        expect(isTransientFailure(Object.assign(new Error("The upload stopped moving"), { __kind: "timeout" }))).toBe(true);
        expect(isTransientFailure(Object.assign(new Error("x"), { __kind: "network" }))).toBe(true);
        expect(isTransientFailure(Object.assign(new SyntaxError("Unexpected token <"), { __kind: "server" }))).toBe(true);
    });

    it("never retries a size limit, the visitor's AI provider, a cancel or a browser failure", () => {
        expect(isTransientFailure(Object.assign(new Error("too big"), { __kind: "too_large" }))).toBe(false);
        expect(isTransientFailure(Object.assign(new Error("401"), { name: "ByokError", kind: "BadKey" }))).toBe(false);
        expect(isTransientFailure(new DOMException("Aborted", "AbortError"))).toBe(false);
        expect(isTransientFailure(new Error("The model returned no summary."))).toBe(false);
        expect(isTransientFailure("worker crashed")).toBe(false);
    });
});

describe("emitToolRun", () => {
    it("adds the failure category to error and partial runs, never the error itself", () => {
        const seen = listen();
        emitToolRun({ outcome: "error", files: 1 }, httpError(413));
        emitToolRun({ mode: "single", outcome: "partial", files: 3 }, httpError(502));
        expect(seen).toEqual([
            { outcome: "error", files: 1, errorKind: "too_large" },
            { mode: "single", outcome: "partial", files: 3, errorKind: "server" },
        ]);
        expect(JSON.stringify(seen)).not.toContain("secret");
    });

    it("ignores a cause on a successful run", () => {
        const seen = listen();
        emitToolRun({ outcome: "success", files: 2, errorKind: "server" }, httpError(500));
        expect(seen).toEqual([{ outcome: "success", files: 2 }]);
    });

    it("lets a caller that knows the reason state it", () => {
        const seen = listen();
        emitToolRun({ outcome: "error", errorKind: "bad_input" });
        emitToolRun({ outcome: "error", errorKind: "bad_input" }, new Error("parse failed"));
        expect(seen).toEqual([{ outcome: "error", errorKind: "bad_input" }, { outcome: "error", errorKind: "bad_input" }]);
    });

    it("reports nothing for a run the user cancelled", () => {
        const seen = listen();
        emitToolRun({ outcome: "error", files: 1 }, new DOMException("Aborted", "AbortError"));
        // A partial run still happened; only its category is unknown.
        emitToolRun({ outcome: "partial", files: 2 }, new DOMException("Aborted", "AbortError"));
        expect(seen).toEqual([{ outcome: "partial", files: 2 }]);
    });

    it("leaves the category unset when the caller has no cause", () => {
        const seen = listen();
        emitToolRun({ outcome: "error", files: 1 });
        emitToolRun({ outcome: "error", files: 1 }, null);
        expect(seen).toEqual([{ outcome: "error", files: 1 }, { outcome: "error", files: 1 }]);
    });

    it("forwards only the run's shape, whatever else the caller attaches", () => {
        const seen = listen();
        const detail = { slug: "merge-pdf", mode: "batch", outcome: "error", files: 2, filename: "secret.pdf", message: "secret text" } as Parameters<typeof emitToolRun>[0];
        emitToolRun(detail, httpError(429));
        expect(seen).toEqual([{ slug: "merge-pdf", mode: "batch", outcome: "error", files: 2, errorKind: "rate_limited" }]);
    });
});
