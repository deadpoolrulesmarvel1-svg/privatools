import { afterEach, describe, expect, it, vi } from "vitest";
import { getErrorStatus, getRequestId, postFormData } from "@/lib/api";

const noRetry = { attempts: 0, backoffMs: 1 };

describe("api form-data helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
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
});
