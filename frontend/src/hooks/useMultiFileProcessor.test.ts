import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMultiFileProcessor, type ProcessOptions } from "./useMultiFileProcessor";
import { installNetwork } from "@/test/fake-network";
import { withUserMessage } from "@/lib/api";

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

  it("counts a file returned unchanged as a failure of its kind, while the page shows it as done", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("a.png"), file("b.png"), file("c.png")]));
    await act(() => result.current.run(options(async f => f.name === "a.png"
      ? { blob: new Blob(["cleaned"]) }
      : { blob: f, unchanged: f.name === "b.png" ? "bad_input" as const : "browser" as const })));
    expect(result.current.doneCount).toBe(3);
    expect(result.current.failedCount).toBe(0);
    expect(seen).toEqual([{ mode: "single", outcome: "partial", files: 3, errorKind: "bad_input" }]);

    act(() => result.current.reset());
    act(() => result.current.addFiles([file("d.png")]));
    await act(() => result.current.run(options(async f => ({ blob: f, unchanged: "bad_input" }))));
    expect(seen[1]).toEqual({ mode: "single", outcome: "error", files: 1, errorKind: "bad_input" });
  });

  it("names a real failure's category before an unchanged file's", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("a.png"), file("b.png")]));
    await act(() => result.current.run(options(async f => {
      if (f.name === "a.png") throw Object.assign(new Error("too big"), { __kind: "too_large" });
      return { blob: f, unchanged: "bad_input" };
    })));
    expect(seen).toEqual([{ mode: "single", outcome: "error", files: 2, errorKind: "too_large" }]);
  });

  it("shows a message written for people as it is, and rewords others", async () => {
    const { result } = renderHook(() => useMultiFileProcessor());
    act(() => result.current.addFiles([file("a.png"), file("b.png")]));
    await act(() => result.current.run(options(async f => {
      // "damaged" would otherwise be reworded as a damaged PDF.
      if (f.name === "a.png") throw withUserMessage(new Error("This PNG file is damaged: a checksum does not match."));
      throw new Error("file is damaged");
    })));
    expect(result.current.entries.map(entry => entry.error)).toEqual([
      "This PNG file is damaged: a checksum does not match.",
      "This PDF is damaged. Try the Repair PDF tool first, then come back.",
    ]);
  });

  it("emits nothing when a run has no files to process", async () => {
    const seen = listen();
    const { result } = renderHook(() => useMultiFileProcessor());
    await act(() => result.current.run(options(async () => ({ blob: new Blob(["ok"]) }))));
    expect(seen).toEqual([]);
  });
});
