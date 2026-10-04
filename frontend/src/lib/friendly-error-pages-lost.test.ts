/**
 * friendlyError (lib/utils.ts) and a PDF that lost pages.
 *
 * A PDF cut short opens repaired with only some of its pages, and the tools
 * answered with those pages as a success. The server now refuses it, saying
 * how many of its pages could be read and both ways out
 * (backend/app/utils/cleanup.py, pages_lost_message). The rule for a damaged
 * PDF holds "damaged", and would turn that into "This PDF is damaged. Try the
 * Repair PDF tool first, then come back.", without the counts and without
 * downloading it again, which is the way to get every page back.
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

describe("friendlyError and a PDF that lost pages", () => {
    it.each([
        "This PDF is damaged: only 4 of its 6 pages could be read. Download it again, or use Repair PDF to save the pages that survive.",
        "This PDF is damaged: only 1 of its 1,200 pages could be read. Download it again, or use Repair PDF to save the pages that survive.",
    ])("keeps the server's words: %s", (message) => {
        expect(friendlyError(message, "Processing failed")).toBe(message);
    });

    it("still turns the other damaged-PDF messages into its own advice", () => {
        expect(friendlyError(
            "This PDF is damaged, most likely cut short by an interrupted download. Download it again, or fix it with Repair PDF, then try again.",
            "Processing failed",
        )).toBe("This PDF is damaged. Try the Repair PDF tool first, then come back.");
        expect(friendlyError("This PDF appears to be corrupt or invalid.", "Processing failed")).toBe(
            "This PDF is damaged. Try the Repair PDF tool first, then come back.");
    });
});
