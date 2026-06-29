import { afterEach, describe, expect, it, vi } from "vitest";
import {
    apiUrl,
    chooseDownloadFilename,
    getErrorStatus,
    getRequestId,
    postFormData,
    processAndDownload,
    resolveApiOrigin,
    uploadFilesWithProgress,
    uploadFileWithProgress,
} from "@/lib/api";

describe("resolveApiOrigin (api-subdomain split)", () => {
    afterEach(() => {
        document
            .querySelectorAll('meta[name="privatools:api-base"]')
            .forEach((m) => m.remove());
    });

    it("returns same-origin (empty) when no meta tag is present", () => {
        expect(resolveApiOrigin()).toBe("");
    });

    it("uses the injected api-base meta tag, stripping a trailing slash", () => {
        const meta = document.createElement("meta");
        meta.setAttribute("name", "privatools:api-base");
        meta.setAttribute("content", "https://api.privatools.me/");
        document.head.appendChild(meta);
        expect(resolveApiOrigin()).toBe("https://api.privatools.me");
    });

    it("apiUrl normalizes endpoints against the same-origin base by default", () => {
        // No meta tag (removed in afterEach) → API_BASE is "/api".
        expect(apiUrl("/health")).toBe("/api/health");
        expect(apiUrl("/api/compress")).toBe("/api/compress");
    });
});

const noRetry = { attempts: 0, backoffMs: 1 };
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("api form-data helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        restoreBlobUrlMethod("createObjectURL", originalCreateObjectURL);
        restoreBlobUrlMethod("revokeObjectURL", originalRevokeObjectURL);
    });

    it("posts arbitrary FormData through the normalized API route", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("ok", { status: 200 }),
        );
        const buildBody = vi.fn(() => {
            const fd = new FormData();
            fd.append("file", new File(["hello"], "sample.pdf", { type: "application/pdf" }));
            fd.append("quality", "80");
            return fd;
        });

        const res = await postFormData("/api/compress", buildBody, { retry: noRetry });

        expect(await res.text()).toBe("ok");
        expect(buildBody).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/compress");
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
        expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    });

    it("preserves backend detail, status, and request id on errors", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ detail: "Unsupported output format" }), {
                status: 415,
                headers: {
                    "content-type": "application/json",
                    "x-request-id": "req-test-123",
                },
            }),
        );

        const fd = new FormData();
        fd.append("file", new File(["bad"], "sample.bin"));

        let caught: unknown;
        try {
            await postFormData("/convert", fd, { retry: noRetry });
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe("Unsupported output format");
        expect(getErrorStatus(caught)).toBe(415);
        expect(getRequestId(caught)).toBe("req-test-123");
    });

    it("rebuilds FormData bodies for retry attempts", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
            .mockResolvedValueOnce(new Response("ok", { status: 200 }));
        const buildBody = vi.fn(() => {
            const fd = new FormData();
            fd.append("file", new File(["hello"], "sample.pdf", { type: "application/pdf" }));
            return fd;
        });

        const res = await postFormData("/compress", buildBody, {
            retry: { attempts: 1, backoffMs: 1 },
        });

        expect(await res.text()).toBe("ok");
        expect(buildBody).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the historical XHR progress timeout by default", async () => {
        const xhr = stubSuccessfulXhr();

        await uploadFileWithProgress("/compress", new File(["x"], "sample.pdf"));

        expect(xhr.instances[0]?.timeout).toBe(300_000);
    });

    it("honors explicit XHR progress timeout values for single and multi-file uploads", async () => {
        const xhr = stubSuccessfulXhr();
        const file = new File(["x"], "sample.pdf");

        await uploadFileWithProgress("/compress", file, undefined, undefined, undefined, { timeoutMs: 12_345 });
        await uploadFilesWithProgress("/merge", [file], undefined, undefined, undefined, { timeoutMs: 0 });

        expect(xhr.instances[0]?.timeout).toBe(12_345);
        expect(xhr.instances[1]?.timeout).toBe(0);
    });

    it("forwards processAndDownload timeouts into the XHR progress path", async () => {
        const xhr = stubSuccessfulXhr();
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn(() => "blob:test"),
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: vi.fn(),
        });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

        await processAndDownload(
            "/compress",
            new File(["x"], "sample.pdf"),
            "sample-compressed.pdf",
            undefined,
            vi.fn(),
            undefined,
            { timeoutMs: 98_765 },
        );

        expect(xhr.instances[0]?.timeout).toBe(98_765);
    });

    it("keeps original-based filenames when backend returns generic names", async () => {
        expect(chooseDownloadFilename("contract_unlocked.pdf", "unlocked.pdf")).toBe("contract_unlocked.pdf");
        expect(chooseDownloadFilename("scan_compressed.pdf", "compressed.pdf")).toBe("scan_compressed.pdf");
        expect(chooseDownloadFilename("report_split.zip", "split_pages.zip")).toBe("report_split.zip");
        expect(chooseDownloadFilename("contract_unlocked.pdf", "contract_unlocked.pdf")).toBe("contract_unlocked.pdf");
        expect(chooseDownloadFilename("output.pdf", "server_named_report.pdf")).toBe("server_named_report.pdf");
    });
});

function stubSuccessfulXhr() {
    class MockXHR {
        static instances: MockXHR[] = [];
        upload: { onprogress?: (event: ProgressEvent) => void } = {};
        response = new Blob(["ok"], { type: "application/pdf" });
        responseType = "";
        status = 200;
        timeout = -1;
        onabort: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        onloadend: (() => void) | null = null;
        ontimeout: (() => void) | null = null;

        constructor() {
            MockXHR.instances.push(this);
        }

        open = vi.fn();
        abort = vi.fn(() => {
            this.onabort?.();
            this.onloadend?.();
        });
        send = vi.fn(() => {
            this.onload?.();
            this.onloadend?.();
        });
        getAllResponseHeaders = vi.fn(() => "content-type: application/pdf\r\nx-request-id: req-xhr\r\n");
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR);
    return MockXHR;
}

function restoreBlobUrlMethod<T extends "createObjectURL" | "revokeObjectURL">(
    method: T,
    original: (typeof URL)[T] | undefined,
) {
    if (original) {
        Object.defineProperty(URL, method, { configurable: true, value: original });
    } else {
        delete (URL as typeof URL & Record<T, unknown>)[method];
    }
}
