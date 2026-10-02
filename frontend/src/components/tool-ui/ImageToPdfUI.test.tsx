import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImageToPdfUI } from "./ImageToPdfUI";
import { HeicToPdfUI, JpgToPdfUI, PngToPdfUI } from "./NamedImageToPdfVariants";
import { processFilesAndDownload } from "@/lib/api";

vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/lib/api", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/api")>(),
    processFilesAndDownload: vi.fn(async () => undefined),
}));
vi.mock("@/hooks/useFirstSuccess", () => ({ emitToolSuccess: vi.fn() }));
vi.mock("@/lib/toolRun", () => ({ emitToolRun: vi.fn() }));

const MB = 1024 * 1024;

function photos(count: number, { from = 1, bytes = MB, ext = "jpg" } = {}) {
    return Array.from({ length: count }, (_, index) => {
        const file = new File(["x"], `IMG_${from + index}.${ext}`, { type: ext === "jpg" ? "image/jpeg" : "image/heic" });
        Object.defineProperty(file, "size", { value: bytes });
        return file;
    });
}

function choose(files: File[]) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input missing");
    fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});
afterEach(cleanup);

describe("Image to PDF limits", { timeout: 20_000 }, () => {
    it("states how many images and megabytes one PDF takes before anything is chosen", () => {
        render(<ImageToPdfUI />);
        expect(screen.getByText(/One PDF takes up to 100 images, 200 MB in total\./)).toBeVisible();
        expect(screen.getByText("0 of 100 images selected")).toBeVisible();
    });

    it("refuses 100 phone photos that add up to more than 200 MB, saying how much they are", () => {
        render(<ImageToPdfUI />);
        choose(photos(100, { bytes: 3.5 * MB }));

        expect(screen.getByRole("alert")).toHaveTextContent(
            "One PDF takes up to 200 MB of images and this selection is 350.0 MB, so it was not added.",
        );
        expect(screen.getByText("0 of 100 images selected")).toBeVisible();
    });

    it("keeps a running total against the 200 MB cap and refuses the selection that would pass it", () => {
        render(<ImageToPdfUI />);
        choose(photos(50, { bytes: 3.5 * MB }));
        expect(screen.getByText("175.0 MB of 200 MB")).toBeVisible();
        choose(photos(8, { from: 51, bytes: 3.5 * MB }));

        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(
            "One PDF takes up to 200 MB of images. Adding these 8 would make 203.0 MB, so they were not added.",
        );
        expect(screen.getByText("50 of 100 images selected")).toBeVisible();
        // Shown where the selection was made, not after 50 thumbnails.
        const pages = screen.getByRole("region", { name: "Page order" });
        expect(alert.compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("sends 100 images of exactly 200 MB in one request, with the shared upload wait", async () => {
        let finish!: () => void;
        vi.mocked(processFilesAndDownload).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ blob: new Blob(["%PDF-1.7"]), filename: "IMG_1.pdf" }); }));
        render(<ImageToPdfUI />);
        choose(photos(60, { bytes: 2 * MB }));
        choose(photos(40, { from: 61, bytes: 2 * MB }));
        expect(screen.getByText("100 of 100 images selected")).toBeVisible();
        expect(screen.getByText("200.0 MB of 200 MB")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Convert 100 images → PDF" }));

        // Progress shows above the 100 thumbnails, and says a full batch takes a while.
        const progress = await screen.findByRole("status");
        expect(progress).toHaveTextContent("100 images, arranged in one PDF. Large batches can take a few minutes.");
        const pages = screen.getByRole("region", { name: "Page order" });
        expect(progress.compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        expect(processFilesAndDownload).toHaveBeenCalledTimes(1);
        const [endpoint, files, , params, , , options] = vi.mocked(processFilesAndDownload).mock.calls[0];
        expect(endpoint).toBe("/image-to-pdf");
        expect(files.map(file => file.name)).toEqual(Array.from({ length: 100 }, (_, index) => `IMG_${index + 1}.jpg`));
        expect(params).toEqual({ page_size: "auto" });
        // The upload alone can take minutes. The page sets no deadline of its
        // own: lib/api.ts waits while the upload moves, then for the server.
        expect(options?.timeoutMs).toBeUndefined();

        await act(async () => finish());
        expect(await screen.findByText("100 images, one PDF.")).toBeVisible();
    });

    it("refuses a selection that would make 101 images and keeps the images already chosen", () => {
        render(<ImageToPdfUI />);
        choose(photos(60));
        choose(photos(41, { from: 61 }));

        expect(screen.getByRole("alert")).toHaveTextContent(
            "One PDF takes up to 100 images. Adding these 41 would make 101, so they were not added.",
        );
        expect(screen.getByText("60 of 100 images selected")).toBeVisible();
        expect(screen.getByRole("button", { name: "Convert 60 images → PDF" })).toBeEnabled();
        expect(processFilesAndDownload).not.toHaveBeenCalled();
    });

    it("counts in the variant's own noun", () => {
        render(<HeicToPdfUI />);
        choose(photos(2, { ext: "heic" }));
        expect(screen.getByText("2 of 100 HEIC photos selected")).toBeVisible();
    });
});

describe("Image to PDF decode budget", { timeout: 20_000 }, () => {
    it("states it for images other than JPEG, with HEIC counting half", () => {
        render(<ImageToPdfUI />);
        expect(screen.getByText(/One PDF takes up to 100 images, 200 MB in total\. Images other than JPEG can add up to 750 megapixels, with HEIC photos counting half\./)).toBeVisible();
    });

    it("states each tool's own figure, and none for JPEGs, which are not decoded", () => {
        const { unmount } = render(<PngToPdfUI />);
        expect(screen.getByText(/One PDF takes up to 100 images, 200 MB and 750 megapixels in total\./)).toBeVisible();
        unmount();
        render(<HeicToPdfUI />);
        expect(screen.getByText(/One PDF takes up to 100 images, 200 MB and 1,500 megapixels in total\./)).toBeVisible();
        cleanup();
        render(<JpgToPdfUI />);
        expect(screen.getByText(/One PDF takes up to 100 images, 200 MB in total\./)).toBeVisible();
        expect(screen.queryByText(/megapixels/)).toBeNull();
    });

    it("shows the server's refusal as it is, where the user acted", async () => {
        const refusal = "One PDF can take up to 750 megapixels of PNG, WebP, TIFF, BMP, GIF and SVG images; these add up to 1,220.";
        vi.mocked(processFilesAndDownload).mockRejectedValueOnce(new Error(refusal));
        render(<ImageToPdfUI />);
        choose(photos(3, { ext: "png" }));
        fireEvent.click(screen.getByRole("button", { name: "Convert 3 images → PDF" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(refusal);
        expect(screen.getByText("3 of 100 images selected")).toBeVisible();
    });

    it.each([
        [413, "IMG_2041.png has more than 178 megapixels, the most one image can have."],
        [400, "notes.png is not a JPEG, PNG, WebP, HEIC, TIFF, BMP or GIF image."],
        // friendlyError would say "That file is empty (0 bytes)" and drop the name.
        [400, "File IMG_2.png is empty"],
    ])("shows the server's own words for a %i naming the file", async (status, detail) => {
        const refusal = Object.assign(new Error(detail), { __status: status, __detail: detail });
        vi.mocked(processFilesAndDownload).mockRejectedValueOnce(refusal);
        render(<ImageToPdfUI />);
        choose(photos(3, { ext: "png" }));
        fireEvent.click(screen.getByRole("button", { name: "Convert 3 images → PDF" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(detail);
    });

    it("keeps the friendly wording when the server gave no reason of its own", async () => {
        // What lib/api writes for a proxy's bare 413 page; it is not this tool's limit.
        const refusal = Object.assign(new Error("That upload is too large. The maximum is 500 MB per upload."), { __status: 413 });
        vi.mocked(processFilesAndDownload).mockRejectedValueOnce(refusal);
        render(<ImageToPdfUI />);
        choose(photos(3, { ext: "png" }));
        fireEvent.click(screen.getByRole("button", { name: "Convert 3 images → PDF" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("File is too big for the server. Try compressing it first.");
    });
});
