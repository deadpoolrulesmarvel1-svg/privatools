/**
 * friendlyError (lib/utils.ts) and OCR.
 *
 * PDF to Word answers a PDF without text with "This PDF has no text layer —
 * run OCR PDF first to make it searchable" (services/pdf_to_word_service.py).
 * It holds "ocr" and "no text", so the rule for an OCR failure turned it into
 * "OCR couldn't read this PDF…", though no OCR had run.
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

describe("friendlyError and OCR", () => {
    it("keeps PDF to Word's advice to run OCR first", () => {
        const shown = friendlyError("This PDF has no text layer — run OCR PDF first to make it searchable", "Processing failed");
        expect(shown).toContain("Run OCR PDF");
        expect(shown).not.toContain("couldn't read");
    });

    it("still calls a failed OCR run a failure", () => {
        expect(friendlyError("OCR failed: no text found", "Processing failed")).toBe(
            "OCR couldn't read this PDF. Try a higher-resolution scan or different language.");
    });

    it("leaves PDF to Excel's advice as it is", () => {
        const message = "No tables detected. PDF may be a scan — try OCR first to make it searchable";
        expect(friendlyError(message, "Processing failed")).toBe(message);
    });
});
