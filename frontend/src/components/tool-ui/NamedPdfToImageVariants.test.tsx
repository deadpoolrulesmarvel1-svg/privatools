/**
 * What a PDF to PNG, JPG, BMP or SVG download is called.
 *
 * These pages plan a ZIP of pages ("pages.zip"), and a PDF of several pages
 * does come back as one. A one-page PDF comes back as a single image, and the
 * page still named it "<file>_pages.zip": a PNG a phone or computer would not
 * open. The FAQs of PDF to JPG and PDF to SVG told visitors to rename it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
    ...(await original<object>()),
    uploadFileWithProgress: mocks.upload,
    downloadBlob: mocks.download,
}));

import { PdfToBmpUI, PdfToJpgUI, PdfToPngUI, PdfToSvgUI } from "./NamedPdfToImageVariants";

beforeEach(() => {
    mocks.upload.mockReset();
    mocks.download.mockReset();
});

function answer(type: string, name: string): Response {
    return new Response(new Blob(["x"], { type }), {
        headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` },
    });
}

async function downloadName(UI: ComponentType, response: Response): Promise<string> {
    mocks.upload.mockResolvedValueOnce(response);
    const view = render(<UI />);
    const file = new File(["%PDF-1.7"], "letter.pdf", { type: "application/pdf" });
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /^Convert PDF to/ }));
    await screen.findByText("Your file is ready.", undefined, { timeout: 5000 });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    return mocks.download.mock.calls[0][1] as string;
}

describe("PDF to image downloads", () => {
    it.each([
        ["PNG", PdfToPngUI, "image/png", "page_1.png", "letter_pages.png"],
        ["JPG", PdfToJpgUI, "image/jpeg", "page_1.jpg", "letter_pages.jpg"],
        ["BMP", PdfToBmpUI, "image/bmp", "page_1.bmp", "letter_pages.bmp"],
        ["SVG", PdfToSvgUI, "image/svg+xml", "page_1.svg", "letter_pages.svg"],
    ])("name a one-page PDF's %s by what it is", async (_label, UI, type, serverName, expected) => {
        expect(await downloadName(UI, answer(type, serverName))).toBe(expected);
    });

    it("keep the ZIP name for a PDF of several pages", async () => {
        expect(await downloadName(PdfToPngUI, answer("application/zip", "images.zip"))).toBe("letter_pages.zip");
    });
});
