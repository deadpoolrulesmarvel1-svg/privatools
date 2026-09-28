/**
 * What the PDF/A validator's notes say.
 *
 * The server's notes once said a title and an author are "required for
 * PDF/A", which is not so; they now say only that one is missing. Each note
 * opens an explanation matched by its wording, and the title and author
 * notes, which mention "metadata", were explained as the missing PDF/A
 * identifier in the XMP metadata.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
    ...(await original<object>()),
    uploadFile: mocks.upload,
}));

import { PdfaValidatorUI } from "./PdfaValidatorUI";

beforeEach(() => mocks.upload.mockReset());

async function validate(errors: string[]) {
    mocks.upload.mockResolvedValueOnce(new Response(JSON.stringify({ valid: false, standard: "", errors }), {
        headers: { "Content-Type": "application/json" },
    }));
    const view = render(<PdfaValidatorUI />);
    const file = new File(["%PDF-1.7"], "archive.pdf", { type: "application/pdf" });
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Validate PDF\/A/ }));
    await screen.findByText("Potential PDF/A issues", undefined, { timeout: 5000 });
}

function explanationOf(note: string): string {
    fireEvent.click(screen.getByText(note).closest("button")!);
    return screen.getByText("what it means").parentElement!.textContent ?? "";
}

describe("PDF/A validator notes", () => {
    it("explains a missing title without calling it a PDF/A requirement", async () => {
        await validate(["No title in the document's metadata"]);
        const text = explanationOf("No title in the document's metadata");
        expect(text).toMatch(/PDF\/A does not require a title/);
        expect(text).not.toMatch(/pdfaid/);
    });

    it("explains a missing author the same way", async () => {
        await validate(["No author in the document's metadata"]);
        expect(explanationOf("No author in the document's metadata")).toMatch(/PDF\/A does not require an author/);
    });

    it("still explains a missing PDF/A identifier as missing XMP metadata", async () => {
        const note = "The XMP metadata could not be read, so no PDF/A identifier was found. Convert it via the PDF→PDF/A tool to write new metadata.";
        await validate([note]);
        expect(explanationOf(note)).toMatch(/pdfaid:part/);
    });
});
