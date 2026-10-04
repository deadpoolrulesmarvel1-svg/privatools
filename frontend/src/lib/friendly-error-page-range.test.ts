/**
 * friendlyError (lib/utils.ts) and page ranges.
 *
 * "Invalid page range syntax" also contains "invalid page", and the rule for a
 * page outside the PDF came first, so a typing mistake in the range read "One
 * of the page numbers is outside this PDF". The messages below are the
 * backend's own (routes/merge.py, extract_pages.py, delete_pages.py,
 * rotate.py, split.py, utils/page_range.py, utils/exceptions.py).
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

const RANGE_FORMAT = 'That page range isn\'t valid. Use formats like "1-3, 5, 7-end".';
const OUTSIDE = "One of the page numbers is outside this PDF. Check the page count and try again.";

describe("friendlyError and page ranges", () => {
    it.each([
        "Invalid page range syntax. Use formats like '1,3-5,9'",
        "Invalid page number 'abc'.",
    ])("a typing mistake in the range gets the range format: %s", (message) => {
        expect(friendlyError(message, "Processing failed")).toBe(RANGE_FORMAT);
    });

    it.each([
        "Page number is out of range.",
        "Page number '1234567890…' is too large.",
        "page out of range",
    ])("a page that is really outside the PDF keeps its own message: %s", (message) => {
        expect(friendlyError(message, "Processing failed")).toBe(OUTSIDE);
    });

    it("a message that names the page and the page count passes through", () => {
        const message = "Page 12 is out of range (PDF has 5 pages)";
        expect(friendlyError(message, "Processing failed")).toBe(message);
    });
});
