/**
 * How long a page waits on the server, upload included.
 *
 * The server's own limit on a request is five minutes, counted once the whole
 * upload has reached it (REQUEST_TIMEOUT_SECONDS=300 in docker-compose.yml;
 * production nginx buffers the upload before passing the request on, and gives
 * the backend proxy_read_timeout 300s). The page's own deadline must not end an
 * upload that is still moving, however long it takes, nor come before that
 * limit has passed; and a dead connection must still end in an error
 * classified as a timeout. (The browser and the network can still end an
 * upload on their own; see DEFAULT_TIMEOUT_MS in lib/api.ts.)
 *
 * Each test scripts what the connection does with the fake network, which
 * serves fetch and XMLHttpRequest alike, and moves Vitest's fake clock.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_TIMEOUT_MS,
    postFormData,
    processAndDownload,
    uploadFile,
    uploadFiles,
    uploadFilesWithProgress,
    uploadFileWithProgress,
} from "@/lib/api";
import { toolErrorKind } from "@/lib/toolRun";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { installNetwork, MB, MINUTE, SECOND, sizedFile } from "./fake-network";

/** The server's own limit, counted from the end of the upload. */
const SERVER_LIMIT = 5 * MINUTE;
/** The page's deadline: a minute past the server's, so the server's answer comes first. */
const GIVE_UP = 6 * MINUTE;
const noRetry = { attempts: 0, backoffMs: 1 };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Follow a promise without awaiting it, so a test can check it is still pending. */
function watch<T>(promise: Promise<T>) {
    const seen: { settled: boolean; value?: T; error?: unknown } = { settled: false };
    promise.then(
        value => { seen.settled = true; seen.value = value; },
        error => { seen.settled = true; seen.error = error; },
    );
    return seen;
}

/** Let settled requests run their callbacks, without moving the fake clock. */
async function drain() {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
    await drain();
}

describe("the page's deadline", () => {
    it("is a minute past the server's five-minute limit", () => {
        expect(SERVER_LIMIT).toBe(300 * SECOND);
        expect(DEFAULT_TIMEOUT_MS).toBe(GIVE_UP);
    });
});

describe("uploadFile: Split, Split by Text, Organize, and every page on useMultiFileProcessor", () => {
    it("keeps waiting while a 40 MB upload takes 90 seconds, then returns the answer", async () => {
        installNetwork({ uploadMs: 90 * SECOND, answerAfterMs: 5 * SECOND, body: "%PDF split" });
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 40 * MB), { ranges: "1-3" }));

        await advance(94 * SECOND);
        expect(split.settled).toBe(false);
        await advance(1 * SECOND);

        expect(split.error).toBeUndefined();
        expect(await (split.value as Response).text()).toBe("%PDF split");
    });

    it("waits out the server's whole five-minute limit once the upload has gone", async () => {
        installNetwork({ uploadMs: 10 * SECOND, answerAfterMs: SERVER_LIMIT - SECOND });
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 5 * MB), undefined, { retry: noRetry }));

        await advance(10 * SECOND + SERVER_LIMIT - SECOND);

        expect(split.error).toBeUndefined();
        expect((split.value as Response).ok).toBe(true);
    });

    it("gives up, as a timeout, once the upload has not moved for six minutes", async () => {
        const net = installNetwork({ uploadMs: 5 * MINUTE, stallAfterMs: 100 * SECOND });
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 200 * MB), undefined, { retry: noRetry }));

        // Progress is reported every second up to the stall at 100 s.
        await advance(100 * SECOND + GIVE_UP - SECOND);
        expect(split.settled).toBe(false);
        await advance(SECOND);

        expect(toolErrorKind(split.error)).toBe("timeout");
        expect(net.requests).toHaveLength(1);
        expect(net.requests[0].aborted).toBe(true);
    });

    it("gives up, as a timeout, when the server never answers a finished upload", async () => {
        installNetwork({ uploadMs: 30 * SECOND });
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 10 * MB), undefined, { retry: noRetry }));

        await advance(30 * SECOND + GIVE_UP - SECOND);
        expect(split.settled).toBe(false);
        await advance(SECOND);

        expect(toolErrorKind(split.error)).toBe("timeout");
    });

    it("does not try again when the server says its time ran out", async () => {
        // The 504 comes quickly here so that only the retry policy is on trial;
        // in production it comes when the server's five minutes are up.
        const net = installNetwork({ uploadMs: 5 * SECOND, answerAfterMs: 5 * SECOND, status: 504,
            body: '{"detail": "Request timed out after 300 seconds."}', headers: { "content-type": "application/json" } });
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 5 * MB)));

        await advance(10 * SECOND);
        await advance(MINUTE);

        expect(toolErrorKind(split.error)).toBe("timeout");
        expect((split.error as Error).message).toBe("Request timed out after 300 seconds.");
        expect(net.requests).toHaveLength(1);
    });

    it("still stops at once, as a cancel, when the visitor cancels", async () => {
        const net = installNetwork({ uploadMs: 5 * MINUTE, answerAfterMs: SECOND });
        const controller = new AbortController();
        const split = watch(uploadFile("/split", sizedFile("scan.pdf", 100 * MB), undefined, { signal: controller.signal }));

        await advance(45 * SECOND);
        controller.abort();
        await drain();

        expect(toolErrorKind(split.error)).toBe("cancelled");
        expect(net.requests).toHaveLength(1);
        expect(net.requests[0].aborted).toBe(true);
    });
});

describe("uploadFiles: Merge sends up to 100 files, 500 MB in all, in one request", () => {
    // Just under 5 MB each: the 500 MB limit counts the form around the files too.
    const pdfs = Array.from({ length: 100 }, (_, i) => sizedFile(`part-${i + 1}.pdf`, 5 * MB - 4 * 1024));

    it("keeps waiting while 500 MB takes seven minutes to send, then returns the merged PDF", async () => {
        const net = installNetwork({ uploadMs: 7 * MINUTE, answerAfterMs: MINUTE, body: "%PDF merged" });
        const merge = watch(uploadFiles("/merge", pdfs, { page_ranges: "[]" }, { retry: noRetry }));

        await advance(8 * MINUTE);

        expect(merge.error).toBeUndefined();
        expect(await (merge.value as Response).text()).toBe("%PDF merged");
        expect(net.requests).toHaveLength(1);
        expect((net.requests[0].body as FormData).getAll("files")).toHaveLength(100);
    });

    it("still stops at once when the visitor cancels the merge", async () => {
        const net = installNetwork({ uploadMs: 7 * MINUTE, answerAfterMs: MINUTE });
        const controller = new AbortController();
        const merge = watch(uploadFiles("/merge", pdfs, undefined, { signal: controller.signal }));

        await advance(2 * MINUTE);
        controller.abort();
        await drain();

        expect(toolErrorKind(merge.error)).toBe("cancelled");
        expect(net.requests[0].aborted).toBe(true);
    });
});

describe("the progress helpers: GenericUI, SimpleConvertUI and MultiFileUI", () => {
    it("let an upload run past five minutes while it keeps moving, reporting its progress", async () => {
        installNetwork({ uploadMs: 8 * MINUTE, answerAfterMs: 20 * SECOND });
        const seen: number[] = [];
        const convert = watch(uploadFileWithProgress("/compress", sizedFile("video.pdf", 400 * MB), undefined,
            (phase, pct) => { if (phase === "upload") seen.push(pct); }));

        await advance(8 * MINUTE + 20 * SECOND);

        expect(convert.error).toBeUndefined();
        expect((convert.value as Response).ok).toBe(true);
        expect(seen[0]).toBeLessThan(5);
        expect(seen[seen.length - 1]).toBe(100);
    });

    it("give up, as a timeout, six minutes after a multi-file upload stops moving", async () => {
        installNetwork({ uploadMs: 5 * MINUTE, stallAfterMs: 100 * SECOND });
        const combine = watch(uploadFilesWithProgress("/merge", [sizedFile("a.pdf", 50 * MB), sizedFile("b.pdf", 50 * MB)]));

        await advance(100 * SECOND + GIVE_UP - SECOND);
        expect(combine.settled).toBe(false);
        await advance(SECOND);

        expect(toolErrorKind(combine.error)).toBe("timeout");
    });

    it("keep a result that arrives slowly, and give up on one that stops arriving", async () => {
        installNetwork(index => ({ uploadMs: 5 * SECOND, answerAfterMs: 10 * SECOND, body: "x".repeat(1000),
            downloadMs: 8 * MINUTE, downloadStallAfterMs: index === 0 ? undefined : MINUTE }));
        const slow = watch(uploadFileWithProgress("/compress", sizedFile("a.pdf", MB)));
        await advance(15 * SECOND + 8 * MINUTE);
        expect(slow.error).toBeUndefined();
        expect(await (slow.value as Response).text()).toHaveLength(1000);

        const stuck = watch(uploadFileWithProgress("/compress", sizedFile("b.pdf", MB)));
        await advance(15 * SECOND + MINUTE + GIVE_UP - SECOND);
        expect(stuck.settled).toBe(false);
        await advance(SECOND);
        expect(toolErrorKind(stuck.error)).toBe("timeout");
    });
});

describe("requests without a file (URL to PDF, HTML to PDF, QR and barcode pages)", () => {
    const form = () => { const fd = new FormData(); fd.append("url", "https://example.com/"); return fd; };

    it("wait out the server's whole limit, then give up as a timeout", async () => {
        installNetwork({ uploadMs: 0, answerAfterMs: SERVER_LIMIT - SECOND });
        const answered = watch(postFormData("/url-to-pdf", form, { retry: noRetry }));
        await advance(SERVER_LIMIT - SECOND);
        expect(answered.error).toBeUndefined();
        expect((answered.value as Response).ok).toBe(true);

        installNetwork({ uploadMs: 0 });
        const silent = watch(postFormData("/url-to-pdf", form, { retry: noRetry }));
        await advance(GIVE_UP - SECOND);
        expect(silent.settled).toBe(false);
        await advance(SECOND);
        expect(toolErrorKind(silent.error)).toBe("timeout");
    });
});

describe("useMultiFileProcessor: PDF to Word, Protect, Remove Blank Pages, Page Selection and the rest", () => {
    const RUN_EVENT = "privatools:tool-run";

    function listen() {
        const seen: Record<string, unknown>[] = [];
        const record = (event: Event) => seen.push((event as CustomEvent<Record<string, unknown>>).detail);
        window.addEventListener(RUN_EVENT, record);
        return { seen, stop: () => window.removeEventListener(RUN_EVENT, record) };
    }

    it("finishes a PDF to Word run whose upload takes 90 seconds", async () => {
        installNetwork({ uploadMs: 90 * SECOND, answerAfterMs: 30 * SECOND, body: "docx" });
        const events = listen();
        const { result } = renderHook(() => useMultiFileProcessor());
        act(() => result.current.addFiles([sizedFile("thesis.pdf", 60 * MB)]));

        let run!: Promise<unknown>;
        act(() => { run = result.current.run({ endpoint: "/pdf-to-word", outputExt: "docx", outputSuffix: null }); });
        await act(() => advance(2 * MINUTE));
        await act(() => run);

        expect(result.current.entries[0].status).toBe("done");
        expect(events.seen).toEqual([{ mode: "single", outcome: "success", files: 1 }]);
        events.stop();
    });

    it("reports a dead connection as a timeout, and not before six minutes without progress", async () => {
        installNetwork({ uploadMs: 5 * MINUTE, stallAfterMs: 20 * SECOND });
        const events = listen();
        const { result } = renderHook(() => useMultiFileProcessor());
        act(() => result.current.addFiles([sizedFile("secret.pdf", 60 * MB)]));

        let run!: Promise<unknown>;
        act(() => { run = result.current.run({ endpoint: "/protect", outputExt: "pdf", outputSuffix: "protected",
            uploadOptions: { retry: noRetry } }); });
        await act(() => advance(20 * SECOND + GIVE_UP - SECOND));
        expect(result.current.entries[0].status).toBe("running");
        expect(events.seen).toEqual([]);
        await act(() => advance(SECOND));
        await act(() => run);

        expect(result.current.entries[0].status).toBe("failed");
        expect(events.seen).toEqual([{ mode: "single", outcome: "error", files: 1, errorKind: "timeout" }]);
        events.stop();
    });
});

describe("what a page reads from an answer", () => {
    it("keeps a header whose value contains a colon and a space, such as Redact's JSON report", async () => {
        const report = '{"pages": 1, "boxes": 2}';
        installNetwork({ uploadMs: 2 * SECOND, answerAfterMs: SECOND, body: "%PDF redacted",
            headers: { "content-type": "application/pdf", "x-redaction-report": report } });
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

        const redact = watch(processAndDownload("/redact", sizedFile("a.pdf", MB), "a_redacted.pdf", { redactions: "[]" },
            undefined, undefined, { retry: noRetry }));
        await advance(3 * SECOND + 100);

        expect(redact.error).toBeUndefined();
        expect((redact.value as Record<string, string>)["x-redaction-report"]).toBe(report);
    });
});

describe("no page sets a deadline of its own", () => {
    // A page that passes its own timeoutMs can give up before the server's limit,
    // as the 60-, 120- and 180-second overrides once did. Every page uses the
    // shared default in lib/api.ts instead.
    const root = join(process.cwd(), "src");
    function sources(dir: string): string[] {
        return readdirSync(dir).flatMap(name => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return sources(path);
            return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
        });
    }

    it("in any component, page, hook or skin", () => {
        const offenders = ["components", "pages", "hooks", "skins"]
            .flatMap(dir => sources(join(root, dir)))
            .filter(path => /\btimeoutMs\b/.test(readFileSync(path, "utf8")))
            .map(path => relative(root, path));
        expect(offenders).toEqual([]);
    });
});
