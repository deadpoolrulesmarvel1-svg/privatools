import { beforeEach, describe, expect, it } from "vitest";
import { consumeFileHandoff, FILE_HANDOFF_KEY, storeFileHandoff } from "@/lib/file-handoff";

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

describe("file handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a stored file for the intended tool", async () => {
    const source = new File(["hello"], "sample.pdf", { type: "application/pdf" });

    await expect(storeFileHandoff(source, "compress-pdf")).resolves.toBe(true);

    const wrongTool = await consumeFileHandoff("merge-pdf");
    expect(wrongTool).toBeNull();
    expect(sessionStorage.getItem(FILE_HANDOFF_KEY)).toBeTruthy();

    const restored = await consumeFileHandoff("compress-pdf");
    expect(restored).toBeInstanceOf(File);
    expect(restored?.name).toBe("sample.pdf");
    expect(restored?.type).toBe("application/pdf");
    await expect(readText(restored as File)).resolves.toBe("hello");
    expect(sessionStorage.getItem(FILE_HANDOFF_KEY)).toBeNull();
  });

  it("drops stale handoffs instead of pre-filling old files", async () => {
    sessionStorage.setItem(FILE_HANDOFF_KEY, JSON.stringify({
      name: "stale.pdf",
      type: "application/pdf",
      data: "data:application/pdf;base64,Zm9v",
      targetSlug: "compress-pdf",
      createdAt: Date.now() - 11 * 60 * 1000,
    }));

    await expect(consumeFileHandoff("compress-pdf")).resolves.toBeNull();
    expect(sessionStorage.getItem(FILE_HANDOFF_KEY)).toBeNull();
  });
});
