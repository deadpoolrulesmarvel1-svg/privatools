/**
 * Split by Text's own drop zone took any file it was given: drag and drop,
 * and "All files" in the system dialog, pass the picker's filter. A picture
 * became the chosen file, and the visitor learned only after "Split PDF"
 * that the server wanted a PDF, with no word of the tool that can help. Its
 * registry entry is `needsText: "pdf"` (#332), so the shared advice now says
 * where a picture can go: Image to PDF, then OCR PDF.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), uploadFile: mocks.upload, downloadBlob: mocks.download }));

import { SplitByTextUI } from "./SplitByTextUI";

function choose(view: ReturnType<typeof render>, ...files: File[]) {
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files } });
}

function drop(...files: File[]) {
    fireEvent.drop(screen.getByRole("button", { name: "Upload PDF" }), { dataTransfer: { files } });
}

const scan = () => new File(["\x89PNG"], "scan.png", { type: "image/png" });
const pdf = () => new File(["%PDF-1.7"], "statements.pdf", { type: "application/pdf" });

describe("Split by Text's intake", () => {
    beforeEach(() => { window.history.pushState({}, "", "/tool/split-by-text"); mocks.upload.mockReset(); });
    afterEach(() => window.history.pushState({}, "", "/"));

    it("refuses a dropped picture by name and points to Image to PDF, then OCR PDF", () => {
        render(<SplitByTextUI />);
        drop(scan());
        expect(screen.getByRole("alert")).toHaveTextContent(
            "scan.png wasn’t added. Split by Text takes PDF files. Image to PDF can turn it into a PDF first; OCR PDF then gives it text to find.");
        expect(screen.getByRole("link", { name: "Image to PDF" })).toHaveAttribute("href", "/tool/image-to-pdf");
        expect(screen.getByRole("link", { name: "OCR PDF" })).toHaveAttribute("href", "/tool/ocr-pdf");
        // The picture was not taken: the drop zone is still there and nothing can run.
        expect(screen.getByRole("button", { name: "Upload PDF" })).toBeInTheDocument();
        expect(screen.queryByText("scan.png", { selector: "p" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Split PDF/ })).toBeDisabled();
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it("refuses a picture chosen through All files in the system dialog too", () => {
        const view = render(<SplitByTextUI />);
        choose(view, scan());
        expect(screen.getByRole("alert")).toHaveTextContent("scan.png wasn’t added.");
    });

    it("takes the PDF from a mixed drop and names the picture it left", () => {
        render(<SplitByTextUI />);
        drop(scan(), pdf());
        expect(screen.getByText("statements.pdf")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("scan.png wasn’t added.");
    });

    it("takes a PDF with no notice", () => {
        const view = render(<SplitByTextUI />);
        choose(view, pdf());
        expect(screen.getByText("statements.pdf")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("starts the next split without the last refusal, as a fresh intake would", async () => {
        mocks.upload.mockResolvedValueOnce({ blob: async () => new Blob(["PK"]) });
        render(<SplitByTextUI />);
        drop(scan(), pdf());
        fireEvent.change(screen.getByPlaceholderText(/Invoice/), { target: { value: "Statement" } });
        fireEvent.click(screen.getByRole("button", { name: /Split PDF/ }));
        fireEvent.click(await screen.findByRole("button", { name: /Split another/ }));
        expect(screen.getByRole("button", { name: "Upload PDF" })).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
