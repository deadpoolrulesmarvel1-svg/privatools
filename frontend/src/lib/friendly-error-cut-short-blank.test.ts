/**
 * friendlyError (lib/utils.ts) and Remove Blank Pages' answer to a PDF cut short.
 *
 * A PDF cut short can open with every page there but some of them blank,
 * their content lost with the end of the file. Remove Blank Pages refuses to
 * remove pages from such a file, and says why
 * (backend/app/routes/remove_blank_pages.py, CUT_SHORT_MESSAGE). The rule for
 * a damaged PDF turned that into "Try the Repair PDF tool first": Repair keeps
 * those pages as they are, blank, and Remove Blank Pages then removed them,
 * the same loss two steps later. The way out is downloading the file again.
 */
import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/utils";

const CUT_SHORT =
    "Download this PDF again: it was cut short, most likely by an interrupted download. "
    + "Pages that lost their content look blank, so no page was removed; "
    + "Repair PDF can't bring that content back.";

describe("friendlyError and Remove Blank Pages' answer to a PDF cut short", () => {
    it("keeps the server's words, which lead with downloading it again", () => {
        const shown = friendlyError(CUT_SHORT, "Processing failed");
        expect(shown).toBe(CUT_SHORT);
        expect(shown).toMatch(/^Download this PDF again/);
        expect(shown).not.toMatch(/try the repair pdf tool first/i);
    });

    it("keeps them with the whitespace a response may carry", () => {
        expect(friendlyError(`  ${CUT_SHORT}\n`, "Processing failed")).toBe(CUT_SHORT);
    });
});
