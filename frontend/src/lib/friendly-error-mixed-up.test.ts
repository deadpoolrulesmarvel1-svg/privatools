/**
 * friendlyError (lib/utils.ts) and a PDF read as the file attached inside it.
 *
 * A valid PDF carrying a PDF attached without compression, with a common
 * cross-reference defect, came back from most tools with the attachment's
 * pages, as a success (and an updated one, from qpdf's tools, as its older
 * version). The server now refuses it, saying why and what to do
 * (backend/app/utils/cleanup.py MIXED_UP_MESSAGE), and Repair PDF, when it
 * cannot tell the file's pages from the attachment's either, sends the visitor
 * to download it again (backend/app/services/repair_service.py
 * CANNOT_TELL_MESSAGE). The rule for a damaged PDF holds "damaged", and would
 * turn Repair's own words into "Try the Repair PDF tool first", a loop.
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

describe("friendlyError and a PDF read as the file attached inside it", () => {
    it.each([
        "This PDF is damaged: its structure is broken in a way that can mix it up with a file attached inside it or an earlier version of itself. Download it again, or fix it with Repair PDF, then try again.",
        "This PDF is damaged: its structure is broken in a way that mixes it up with a file attached inside it or an earlier version of itself, and Repair PDF can't tell which pages are its own. Download it again.",
    ])("keeps the server's words: %s", (message) => {
        expect(friendlyError(message, "Processing failed")).toBe(message);
        expect(friendlyError(`  ${message}\n`, "Processing failed")).toBe(message);
    });

    it("still turns the other damaged-PDF messages into its own advice", () => {
        expect(friendlyError(
            "This PDF is damaged, most likely cut short by an interrupted download. Download it again, or fix it with Repair PDF, then try again.",
            "Processing failed",
        )).toBe("This PDF is damaged. Try the Repair PDF tool first, then come back.");
    });
});
