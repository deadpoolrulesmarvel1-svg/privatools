/**
 * The server's refusals to draw reach the visitor as it wrote them.
 *
 * friendlyError (lib/utils.ts) rewrites any message containing "too large"
 * into "File is too big for the server. Try compressing it first." The old
 * refusal for a page too large to draw said "too large to render", so a
 * visitor with a poster-sized page was told to compress a file whose size had
 * nothing to do with it. The refusals are now worded so they pass through.
 * The messages below are the backend's formats (backend/app/utils/render.py).
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

describe("render refusals", () => {
    it.each([
        "A page of this PDF is bigger than the server can draw: 12,247 × 8,165 pixels, about 100 megapixels, where the limit is 100 a page. Make the page smaller with Resize PDF, or choose a lower resolution where the tool offers one.",
        "This PDF would need about 2,400 megapixels of drawing, and one request can draw up to 2,000. Split the PDF and convert the parts separately, or choose a lower resolution in PDF to Image.",
        "This PDF would need about 520 megapixels of drawing, and one request can draw up to 400. Split the PDF and deskew the parts separately.",
        "This PDF would need about 2,100 megapixels of drawing, and one request can draw up to 2,000. Choose a lower quality, or split the PDF and invert the parts separately.",
    ])("pass through unchanged: %s", (message) => {
        expect(friendlyError(message, "Processing failed")).toBe(message);
    });

    it("would have been rewritten in the old wording", () => {
        const old = "A page is too large to render (12247×8165 px, ~100 MP). Max 100 MP per page — reduce the resolution or the source page size.";
        expect(friendlyError(old, "Processing failed")).toMatch(/Try compressing it first/);
    });
});
