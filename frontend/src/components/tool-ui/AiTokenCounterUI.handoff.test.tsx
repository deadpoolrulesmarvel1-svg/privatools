/**
 * A file handed to the AI Token Counter by another tool (PDF to Markdown's
 * "Count its tokens", or a selection made on the home page) arrives chosen,
 * ready to count. The hand-off keeps the File in this tab's memory; nothing
 * is uploaded to make it work.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFileHandoffs, storeFileHandoffs } from "@/lib/file-handoff";
import { AiTokenCounterUI } from "./AiTokenCounterUI";

afterEach(() => {
    cleanup();
    clearFileHandoffs();
    vi.unstubAllGlobals();
});

describe("a file handed to the AI Token Counter", () => {
    it("arrives chosen, ready to count, without a request", async () => {
        const network = vi.fn(async () => { throw new Error("unexpected network request"); });
        vi.stubGlobal("fetch", network);
        await storeFileHandoffs([new File(["# Quarterly notes\n\nSome text.\n"], "report.md", { type: "text/markdown" })], "ai-token-counter");
        render(<AiTokenCounterUI />);
        expect(await screen.findByText("report.md")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Count tokens/ })).toBeEnabled();
        expect(network).not.toHaveBeenCalled();
    });

    it("leaves a file meant for another tool alone", async () => {
        await storeFileHandoffs([new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" })], "compress-pdf");
        render(<AiTokenCounterUI />);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(screen.queryByText("report.pdf")).toBeNull();
        expect(screen.getByRole("button", { name: /Count tokens/ })).toBeDisabled();
    });
});
