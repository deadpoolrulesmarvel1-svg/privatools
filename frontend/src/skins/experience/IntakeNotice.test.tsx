/**
 * A picture refused by a tool that looks for words in a PDF's text layer is
 * pointed to two tools, Image to PDF and then OCR PDF, and both are links.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { adviseRejection } from "@/lib/file-acceptance";
import { IntakeNotice } from "./ToolStudio";

describe("IntakeNotice", () => {
    it("links both steps for a picture dropped on Smart Redact", () => {
        render(<IntakeNotice advice={adviseRejection([{ name: "scan.png", type: "image/png" }], { fromSlug: "smart-redact" })} />);
        expect(screen.getByRole("alert")).toHaveTextContent(
            "scan.png wasn’t added. Smart Redact (AI) takes PDF files. Image to PDF can turn it into a PDF first; OCR PDF then gives it text to find.");
        expect(screen.getByRole("link", { name: "Image to PDF" })).toHaveAttribute("href", "/tool/image-to-pdf");
        expect(screen.getByRole("link", { name: "OCR PDF" })).toHaveAttribute("href", "/tool/ocr-pdf");
    });

    it("links the one tool for a picture dropped on a tool that works on the page itself", () => {
        render(<IntakeNotice advice={adviseRejection([{ name: "photo.png", type: "image/png" }], { fromSlug: "rotate-pdf", prefer: "convert" })} />);
        expect(screen.getByRole("alert")).toHaveTextContent("Image to PDF can turn it into a PDF first.");
        expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual(["Image to PDF"]);
    });
});
