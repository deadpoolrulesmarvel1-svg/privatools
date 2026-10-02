/**
 * The shared queue offers a retry after a partial run only for the failures
 * another attempt could fix, and every failed row says its reason. Before
 * step 2b it said "Retry 1" for any failure, a refused file included.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

afterEach(cleanup);

const entry = (name: string, patch: Partial<FileEntry>): FileEntry => ({ id: name, name, size: 1024, file: new File(["x"], name), status: "done", ...patch });
const handlers = { onRemove: vi.fn(), onReorder: vi.fn(), onClearAll: vi.fn() };

describe("MultiFileQueue after a partial run", () => {
    it("offers no retry for a refused file, and says its reason on its row", () => {
        const onRetryFailed = vi.fn();
        render(<MultiFileQueue {...handlers} onRetryFailed={onRetryFailed} entries={[
            entry("good.pdf", {}),
            entry("fake.pdf", { status: "failed", error: "This doesn’t look like a valid PDF.", errorKind: "bad_input", retryable: false }),
        ]} />);
        expect(screen.getByText("This doesn’t look like a valid PDF.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Retry|Try .*again/ })).toBeNull();
    });

    it("offers \"Try again\" only for the failures another attempt could fix, with the recorded reason", () => {
        const onRetryFailed = vi.fn();
        render(<MultiFileQueue {...handlers} onRetryFailed={onRetryFailed} entries={[
            entry("good.pdf", {}),
            entry("fake.pdf", { status: "failed", error: "This doesn’t look like a valid PDF.", errorKind: "bad_input", retryable: false }),
            entry("slow.pdf", { status: "failed", error: "It took too long.", errorKind: "timeout", retryable: true }),
        ]} />);
        expect(screen.getByText(/It ran out of time\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(onRetryFailed).toHaveBeenCalledOnce();
    });
});
