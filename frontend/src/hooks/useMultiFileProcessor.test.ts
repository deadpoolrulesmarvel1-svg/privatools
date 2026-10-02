import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useMultiFileProcessor, type ProcessOptions } from "./useMultiFileProcessor";
import { installNetwork } from "@/test/fake-network";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

const RUN_EVENT = "privatools:tool-run";
type Detail = Record<string, unknown>;

function listen(): Detail[] {
  const seen: Detail[] = [];
  window.addEventListener(RUN_EVENT, event => seen.push((event as CustomEvent<Detail>).detail));
  return seen;
}
function file(name: string): File { return new File(["x"], name, { type: "text/plain" }); }
function options(localProcess: ProcessOptions["localProcess"]): ProcessOptions {
  return { endpoint: "noop", outputExt: "txt", outputSuffix: null, localProcess };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useMultiFileProcessor usage events", () => {
  it("emits one single-mode tool run with the file count when every file succeeds", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("a.txt"), file("b.txt")]));
    await act(() => result.current.run(options(async () => ({ blob: new Blob(["ok"]) }))));
    expect(result.current.doneCount).toBe(2);
    expect(seen).toEqual([{ mode: "single", outcome: "success", files: 2 }]);
  });

  it("reports partial and error outcomes without leaking names or messages", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("secret-a.txt"), file("secret-b.txt")]));
    await act(() => result.current.run(options(async f => { if (f.name === "secret-b.txt") throw new Error("boom secret"); return { blob: new Blob(["ok"]) }; })));
    await act(() => result.current.run(options(async () => { throw new Error("boom secret"); }), true));
    // A local processor that throws failed in the browser.
    expect(seen).toEqual([
      { mode: "single", outcome: "partial", files: 2, errorKind: "browser" },
      { mode: "single", outcome: "error", files: 1, errorKind: "browser" },
    ]);
    expect(JSON.stringify(seen)).not.toContain("secret");
  });

  it("reports the category of a server refusal", async () => {
    const seen = listen();
    installNetwork({ uploadMs: 0, answerAfterMs: 0, status: 429, body: "slow down" });
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("secret.txt")]));
    await act(() => result.current.run({ endpoint: "/compress", outputExt: "txt", outputSuffix: null, uploadOptions: { retry: { attempts: 0, backoffMs: 1 } } }));
    expect(seen).toEqual([{ mode: "single", outcome: "error", files: 1, errorKind: "rate_limited" }]);
  });

  it("emits nothing when a run has no files to process", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    await act(() => result.current.run(options(async () => ({ blob: new Blob(["ok"]) }))));
    expect(seen).toEqual([]);
  });
});

const isPdf = (f: File) => f.name.toLowerCase().endsWith(".pdf");
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { __status: status });

describe("useMultiFileProcessor refused files", () => {
  it("never drops a refused file silently: it is returned and named in a toast with the tool that takes it", () => {
    vi.mocked(toast.error).mockClear();
    window.history.pushState({}, "", "/tool/compress-pdf");
    const { result } = renderHook(() => useMultiFileProcessor());
    let refused: File[] = [];
    act(() => { refused = result.current.addFiles([file("report.pdf"), file("holiday.png")], isPdf); });
    expect(result.current.entries.map(entry => entry.name)).toEqual(["report.pdf"]);
    expect(refused.map(f => f.name)).toEqual(["holiday.png"]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [headline, details] = vi.mocked(toast.error).mock.calls[0] as unknown as [string, { description: string; action: { label: string } }];
    expect(headline).toBe("holiday.png wasn’t added.");
    expect(details.description).toBe("Compress PDF takes PDF files. Try Image Compressor for PNG files.");
    expect(details.action.label).toBe("Open Image Compressor");
    window.history.pushState({}, "", "/");
  });

  it("stays quiet when every file is taken, or when the caller shows the refusal itself", () => {
    vi.mocked(toast.error).mockClear();
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => { result.current.addFiles([file("a.pdf")], isPdf); });
    act(() => { result.current.addFiles([file("b.png")], isPdf, { report: false }); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(1);
  });
});

describe("useMultiFileProcessor retries", () => {
  it("marks which failures another attempt could fix, and retries only those with \"transient\"", async () => {
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => { result.current.addFiles([file("flaky.txt"), file("broken.txt")]); });
    const attempts: string[] = [];
    const process = options(async f => { attempts.push(f.name); throw f.name === "flaky.txt" ? httpError(503) : httpError(400); });
    await act(() => result.current.run(process));
    expect(result.current.entries.map(entry => [entry.name, entry.errorKind, entry.retryable]))
      .toEqual([["flaky.txt", "server", true], ["broken.txt", "bad_input", false]]);
    expect(result.current.retryableCount).toBe(1);
    attempts.length = 0;
    await act(() => result.current.run(options(async () => ({ blob: new Blob(["ok"]) })), "transient"));
    expect(result.current.entries.map(entry => [entry.name, entry.status])).toEqual([["flaky.txt", "done"], ["broken.txt", "failed"]]);
    expect(result.current.retryableCount).toBe(0);
  });
});
