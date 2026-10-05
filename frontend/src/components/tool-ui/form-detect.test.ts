import { describe, expect, it } from "vitest";
import {
    detectFailure, detectNotes, detectSummary, fieldFromProposal, newCandidates, samePlace, uniqueName,
    type DetectReport, type Proposal,
} from "./form-detect";

const report = (extra: Partial<DetectReport> = {}): DetectReport => ({
    pages: 3, candidates: [], truncated: false, scanPages: [], complexPages: [], pagesNotChecked: [], existingFields: 0, ...extra,
});
const candidate = (id: string, page: number, x: number, y: number, extra: Partial<Proposal> = {}): Proposal => ({
    id, key: id, page, x, y, width: 200, height: 18, type: "text", name: id, label: `${id}:`, confidence: 0.9, multiline: false, ...extra,
});

describe("Form Creator's detection helpers", () => {
    it("never proposes a blank a placed field already covers", () => {
        const found = report({ candidates: [candidate("a", 1, 100, 100), candidate("b", 1, 100, 140), candidate("c", 2, 100, 100)] });
        const placed = [{ page: 1, x: 105, y: 101, width: 190, height: 16 }];
        expect(newCandidates(found, placed).map(c => c.id)).toEqual(["b", "c"]);
        expect(samePlace({ page: 1, x: 0, y: 0, width: 10, height: 10 }, { page: 2, x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    });

    it("numbers a name that is taken", () => {
        const taken = new Set(["full_name", "full_name_2"]);
        expect(uniqueName("full_name", taken)).toBe("full_name_3");
        expect(uniqueName("  ", taken)).toBe("field");
        expect(taken.has("full_name_3") && taken.has("field")).toBe(true);
    });

    it("makes a date a text field and keeps multi-line only for text", () => {
        expect(fieldFromProposal(candidate("d", 2, 10.04, 20.06, { type: "date" }), "date_of_birth"))
            .toEqual({ name: "date_of_birth", type: "text", page: "2", x: "10", y: "20.1", width: "200", height: "18", multiline: false });
        expect(fieldFromProposal(candidate("m", 1, 0, 0, { multiline: true }), "m").multiline).toBe(true);
        expect(fieldFromProposal(candidate("s", 1, 0, 0, { type: "signature", multiline: true }), "s").multiline).toBe(false);
    });

    it("says what was found, and what could not be looked at, in plain words", () => {
        expect(detectSummary(report(), 0)).toMatch(/^No likely fields were found\..*choose Draw a field/);
        expect(detectSummary(report({ candidates: [candidate("a", 1, 0, 0), candidate("b", 3, 0, 0)] }), 2))
            .toMatch(/^Found 2 possible fields on 2 pages\./);
        expect(detectSummary(report({ candidates: [candidate("a", 1, 0, 0)] }), 0)).toBe("Found 1 possible field, all of them already placed.");
        expect(detectNotes(report({ scanPages: [1, 2, 4], complexPages: [3], pagesNotChecked: [5], truncated: true, candidates: [candidate("a", 1, 0, 0)] }))).toEqual([
            "Pages 1, 2 and 4 are pictures, as scanned pages are, so nothing could be found there. Place fields on them by hand.",
            "Page 3 draws too much to read its lines and boxes; only typed blanks and checkbox characters were looked for there.",
            "Page 5 could not be read, so it was not checked.",
            "More fields were found than one form can take; the 1 most likely are proposed.",
        ]);
    });

    it("shows a refusal's own words, and anything else as shared advice", () => {
        const refusal = Object.assign(new Error("x"), { __status: 413, __detail: "This PDF has 80 pages, and field detection reads at most 50." });
        expect(detectFailure(refusal)).toBe("This PDF has 80 pages, and field detection reads at most 50.");
        const locked = Object.assign(new Error("This PDF is password-protected. Unlock it first, then try again."), { __status: 400 });
        expect(detectFailure(locked)).toBe("This PDF is password-protected. Unlock it first, then try again.");
        expect(detectFailure(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach the server/);
        expect(detectFailure("strange")).toMatch(/^Couldn't look for fields in this PDF/);
    });
});
