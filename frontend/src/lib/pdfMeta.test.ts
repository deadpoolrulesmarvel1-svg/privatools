import { describe, it, expect, vi } from "vitest";
import { countPdfPages } from "./pdfMeta";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
const readBytes = async () => new Uint8Array([1, 2, 3]).buffer;

describe("countPdfPages", () => {
  it("returns 0 for no files", async () => {
    expect(await countPdfPages([], readBytes, vi.fn())).toBe(0);
  });

  it("counts a single document", async () => {
    const open = vi.fn(async () => ({ numPages: 12, destroy: vi.fn() }));
    expect(await countPdfPages([file("a.pdf")], readBytes, open)).toBe(12);
  });

  it("sums across several documents", async () => {
    const pages = [3, 5, 7];
    let i = 0;
    const open = vi.fn(async () => ({ numPages: pages[i++], destroy: vi.fn() }));
    expect(await countPdfPages([file("a.pdf"), file("b.pdf"), file("c.pdf")], readBytes, open)).toBe(15);
  });

  it("destroys each document it opens", async () => {
    const destroy = vi.fn();
    const open = vi.fn(async () => ({ numPages: 2, destroy }));
    await countPdfPages([file("a.pdf"), file("b.pdf")], readBytes, open);
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("treats an unreadable file as zero rather than throwing", async () => {
    let call = 0;
    const open = vi.fn(async () => {
      if (call++ === 0) throw new Error("encrypted");
      return { numPages: 4, destroy: vi.fn() };
    });
    expect(await countPdfPages([file("bad.pdf"), file("ok.pdf")], readBytes, open)).toBe(4);
  });

  it("tolerates a document with no numPages", async () => {
    const open = vi.fn(async () => ({}) as { numPages: number });
    expect(await countPdfPages([file("a.pdf")], readBytes, open)).toBe(0);
  });
});
