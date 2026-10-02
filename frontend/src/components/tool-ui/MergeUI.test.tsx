import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MergeUI } from "./MergeUI";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { uploadFiles, downloadBlob } from "@/lib/api";
import { openMergePreview } from "./merge-preview";
import { useIsMobile } from "@/hooks/use-mobile";

vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), uploadFiles: vi.fn(), downloadBlob: vi.fn() }));
vi.mock("./merge-preview", () => ({ openMergePreview: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: vi.fn(() => false) }));
vi.mock("@/hooks/useFirstSuccess", () => ({ emitToolSuccess: vi.fn() }));
vi.mock("./ResultHandoff", () => ({ ResultHandoff: ({ filename }: { filename: string }) => <div data-testid="result-handoff">{filename}</div> }));

function pdf(name: string) { return new File(["%PDF-example"], name, { type: "application/pdf" }); }
function response() { return { blob: async () => new Blob(["%PDF-merged"], { type: "application/pdf" }) } as Response; }
function addFiles(files = [pdf("notes.pdf"), pdf("checklist.pdf")]) {
    fireEvent.change(screen.getByLabelText("Choose PDFs to merge"), { target: { files } });
}
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Merge 4 pages" })).toBeEnabled()); }

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(consumeFileHandoffs).mockResolvedValue([]);
    vi.mocked(uploadFiles).mockResolvedValue(response());
    vi.mocked(openMergePreview).mockImplementation(async file => ({
        numPages: file instanceof File && file.name === "notes.pdf" ? 3 : file instanceof File ? 1 : 4,
        destroy: vi.fn(async () => {}),
        getPage: vi.fn(async () => ({
            getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
            render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        })),
    }) as never);
});
afterEach(cleanup);

describe("Merge workspace", { timeout: 20_000 }, () => {
    it("reads the entire home handoff once under StrictMode without uploading", async () => {
        vi.mocked(consumeFileHandoffs).mockResolvedValue([pdf("notes.pdf"), pdf("checklist.pdf")]);
        render(<StrictMode><MergeUI /></StrictMode>);
        await ready();
        expect(consumeFileHandoffs).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole("button", { name: /^Remove .*pdf$/ })).toHaveLength(2);
        expect(uploadFiles).not.toHaveBeenCalled();
        expect(screen.getByText("Processing: temporary server upload")).toBeVisible();
    });

    it("preserves selected pages, filename, and file order in the real merge request", async () => {
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.click(screen.getByRole("button", { name: "Exclude page 2 of notes.pdf" }));
        expect(screen.getByLabelText("notes.pdf")).toHaveValue("1,3");
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "3,1" } });
        fireEvent.click(screen.getByRole("button", { name: "Move checklist.pdf up" }));
        fireEvent.change(screen.getByLabelText("Output filename"), { target: { value: "Together" } });
        fireEvent.click(screen.getByRole("button", { name: "Merge 3 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        expect(uploadFiles).toHaveBeenCalledTimes(1);
        const [, files, params, options] = vi.mocked(uploadFiles).mock.calls[0];
        expect(files.map(file => file.name)).toEqual(["checklist.pdf", "notes.pdf"]);
        expect(params).toEqual({ page_ranges: '["all","3,1"]' });
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(screen.getByTestId("result-handoff")).toHaveTextContent("Together.pdf");
        // The download policy: the merged PDF downloads by itself, once, and the result offers it again.
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "Together.pdf");
        fireEvent.click(screen.getByRole("button", { name: "Download again" }));
        expect(downloadBlob).toHaveBeenCalledTimes(2);
        expect(vi.mocked(downloadBlob).mock.calls[1][1]).toBe("Together.pdf");
    });

    it("keeps out-of-bounds ranges and a one-file selection from reaching the server", async () => {
        render(<MergeUI />);
        addFiles([pdf("notes.pdf")]);
        await waitFor(() => expect(screen.getByRole("button", { name: "Add one more PDF" })).toBeDisabled());
        addFiles([pdf("checklist.pdf")]);
        await ready();
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "4" } });
        expect(screen.getByLabelText("notes.pdf")).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("button", { name: "Merge 2 PDFs" })).toBeDisabled();
        fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
        expect(uploadFiles).not.toHaveBeenCalled();
    });

    it("rejects a mixed file selection visibly without silently dropping a file", () => {
        render(<MergeUI />);
        addFiles([pdf("notes.pdf"), new File(["image"], "photo.png", { type: "image/png" })]);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("photo.png isn’t a PDF, so this selection wasn’t added. Merge PDF takes PDF files. Image to PDF can turn it into a PDF first.");
        expect(within(alert).getByRole("link", { name: "Image to PDF" })).toHaveAttribute("href", "/tool/image-to-pdf");
        expect(screen.queryByRole("button", { name: "Remove notes.pdf" })).not.toBeInTheDocument();
        expect(uploadFiles).not.toHaveBeenCalled();
    });

    it("leaves out a file this browser can't read as a PDF, says so, and merges the rest", async () => {
        const preview = vi.mocked(openMergePreview).getMockImplementation()!;
        vi.mocked(openMergePreview).mockImplementation(async file => {
            if (file instanceof File && file.name === "not-really-a.pdf") throw Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" });
            return preview(file);
        });
        render(<MergeUI />);
        addFiles([pdf("notes.pdf"), pdf("not-really-a.pdf"), pdf("checklist.pdf")]);
        await ready();
        expect(screen.getByText("This doesn’t look like a valid PDF.")).toBeVisible();
        expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
        expect(screen.getByText(/3 files · 1 left out/)).toBeInTheDocument();
        expect(screen.queryByLabelText("not-really-a.pdf")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        const [, files, params] = vi.mocked(uploadFiles).mock.calls[0];
        expect(files.map(file => file.name)).toEqual(["notes.pdf", "checklist.pdf"]);
        expect(params).toEqual({ page_ranges: '["all","all"]' });
    });

    it("leaves out a PDF locked with a password and points to Unlock PDF", async () => {
        const preview = vi.mocked(openMergePreview).getMockImplementation()!;
        vi.mocked(openMergePreview).mockImplementation(async file => {
            if (file instanceof File && file.name === "locked.pdf") throw Object.assign(new Error("No password given"), { name: "PasswordException" });
            return preview(file);
        });
        render(<MergeUI />);
        addFiles([pdf("notes.pdf"), pdf("locked.pdf")]);
        await waitFor(() => expect(screen.getByText("This PDF is locked with a password.")).toBeVisible());
        expect(screen.getByRole("link", { name: "Unlock PDF" })).toHaveAttribute("href", "/tool/unlock-pdf");
        expect(screen.getByRole("button", { name: "Add one more PDF" })).toBeDisabled();
    });

    it("refuses PDFs that would take the merge past the 500 MB one upload can carry, before anything is sent", async () => {
        const sized = (name: string, mb: number) => {
            const file = pdf(name);
            Object.defineProperty(file, "size", { value: mb * 1024 * 1024 });
            return file;
        };
        render(<MergeUI />);
        addFiles([sized("volume-1.pdf", 300), sized("volume-2.pdf", 150)]);
        await waitFor(() => expect(screen.getByRole("button", { name: "Merge 2 PDFs" })).toBeEnabled());
        addFiles([sized("volume-3.pdf", 60)]);
        expect(screen.getByRole("alert")).toHaveTextContent(
            "You can merge up to 500 MB at a time, counting the form the PDFs are sent in. Adding “volume-3.pdf” would make 510.0 MB, so it was not added.");
        addFiles([sized("volume-3.pdf", 30), sized("volume-4.pdf", 30)]);
        expect(screen.getByRole("alert")).toHaveTextContent(
            "You can merge up to 500 MB at a time, counting the form the PDFs are sent in. Adding these 2 PDFs would make 510.0 MB, so they were not added.");
        expect(screen.getAllByRole("button", { name: /^Remove .*pdf$/ })).toHaveLength(2);
        addFiles([sized("volume-3.pdf", 49)]);
        await waitFor(() => expect(screen.getByRole("button", { name: "Merge 3 PDFs" })).toBeEnabled());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(uploadFiles).not.toHaveBeenCalled();
    });

    it("keeps a large file in the merge while avoiding an excessive preview allocation", async () => {
        const large = pdf("large.pdf");
        Object.defineProperty(large, "size", { value: 70 * 1024 * 1024 });
        render(<MergeUI />);
        addFiles([large, pdf("checklist.pdf")]);
        await waitFor(() => expect(screen.getByRole("button", { name: "Merge 2 PDFs" })).toBeEnabled());
        expect(screen.getByText(/Preview skipped to keep memory use low/)).toBeVisible();
        expect(vi.mocked(openMergePreview).mock.calls.some(([file]) => file === large)).toBe(false);
        expect(screen.queryByRole("region", { name: "Preview of page order" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Merge 2 PDFs" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        expect(vi.mocked(uploadFiles).mock.calls[0][1]).toEqual([large, expect.objectContaining({ name: "checklist.pdf" })]);
    });

    it("discards a cancelled response even if it arrives after the next successful merge", async () => {
        let resolveFirst!: (value: Response) => void;
        vi.mocked(uploadFiles).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        const firstSignal = vi.mocked(uploadFiles).mock.calls[0][3]!.signal!;
        fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
        expect(firstSignal.aborted).toBe(true);
        fireEvent.change(screen.getByLabelText("Output filename"), { target: { value: "Fresh.pdf" } });
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        await act(async () => { resolveFirst(response()); });
        expect(screen.getByTestId("result-handoff")).toHaveTextContent("Fresh.pdf");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        // Only the run that finished downloads, once; the cancelled response downloads nothing.
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "Fresh.pdf");
    });

    it("invalidates the previous download before editing and uses the revised selection", async () => {
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        fireEvent.click(screen.getByRole("button", { name: "Adjust pages" }));
        expect(screen.queryByRole("button", { name: "Download again" })).not.toBeInTheDocument();
        expect(screen.queryByTestId("result-handoff")).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "1" } });
        fireEvent.click(screen.getByRole("button", { name: "Merge 2 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        expect(vi.mocked(uploadFiles).mock.calls[1][2]).toEqual({ page_ranges: '["1","all"]' });
        fireEvent.click(screen.getByRole("button", { name: "Start another merge" }));
        expect(screen.getByRole("button", { name: "Choose PDFs" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Download again" })).not.toBeInTheDocument();
    });

    it("retains inputs after a server error and aborts a request when unmounted", async () => {
        vi.mocked(uploadFiles).mockRejectedValueOnce(new Error("Network error"));
        const { unmount } = render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        await screen.findByRole("alert");
        expect(screen.getByRole("button", { name: "Merge 4 pages" })).toBeEnabled();
        expect(screen.getAllByRole("button", { name: /^Remove .*pdf$/ })).toHaveLength(2);
        vi.mocked(uploadFiles).mockImplementationOnce(() => new Promise(() => {}));
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        const signal = vi.mocked(uploadFiles).mock.calls[1][3]!.signal!;
        unmount();
        expect(signal.aborted).toBe(true);
    });

    it("shows the page order specified by a nonascending range", async () => {
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "3,1" } });
        const order = screen.getByRole("region", { name: "Preview of page order" });
        expect(within(order).getAllByRole("img").map(image => image.getAttribute("aria-label"))).toEqual([
            "Output page 1: notes.pdf, page 3", "Output page 2: notes.pdf, page 1", "Output page 3: checklist.pdf, page 1",
        ]);
    });

    it("saves a reusable operation without retaining source names, output names, or page ranges", async () => {
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "3,1" } });
        fireEvent.change(screen.getByLabelText("Output filename"), { target: { value: "Private result.pdf" } });
        fireEvent.click(screen.getByRole("button", { name: "Merge 3 pages" }));
        await screen.findByRole("heading", { name: "Your PDF is ready" });
        fireEvent.click(screen.getByRole("button", { name: "Save workflow" }));
        const saved = JSON.parse(localStorage.getItem("privatools_pipeline_saved")!);
        expect(saved).toEqual([{ name: "Merge PDFs", slugs: ["merge-pdf"], savedAt: expect.any(Number) }]);
        expect(screen.getByText(/Choose files, page ranges, order, and filename again each time/)).toBeVisible();
        expect(screen.getByRole("button", { name: "Workflow saved" })).toBeDisabled();
        expect(screen.getByRole("link", { name: "your home workspace" })).toHaveAttribute("href", "/");
    });

    it("maps mobile result thumbnails back to ordered sources and keeps extra details collapsed", async () => {
        vi.mocked(useIsMobile).mockReturnValue(true);
        render(<MergeUI />);
        addFiles();
        await ready();
        fireEvent.change(screen.getByLabelText("notes.pdf"), { target: { value: "3,1,2" } });
        fireEvent.click(screen.getByRole("button", { name: "Move checklist.pdf up" }));
        fireEvent.click(screen.getByRole("button", { name: "Merge 4 pages" }));
        const strip = await screen.findByRole("group", { name: "Choose a result page" });
        expect(within(strip).getByRole("button", { name: "Show 1 · checklist.pdf, page 1" })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(within(strip).getByRole("button", { name: "Show 2 · notes.pdf, page 3" }));
        await waitFor(() => expect(screen.getByRole("img", { name: "Merged PDF, 2 · notes.pdf, page 3" })).not.toHaveClass("merge-canvas-pending"));
        expect(screen.getByText("Merge details").closest("details")).not.toHaveAttribute("open");
        expect(screen.getByRole("button", { name: "Download again" })).toBeVisible();
    });
});
