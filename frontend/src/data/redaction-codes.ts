/**
 * Statutory exemption codes stamped onto redaction boxes.
 *
 * These are the citations a US federal agency puts on a released page to say
 * under what authority material was withheld. Adobe ships FOIA and Privacy Act
 * sets pre-populated; no other free PDF tool has them at all.
 *
 * Short labels are what gets drawn inside the box — they have to stay short,
 * because the box is the size of the text that used to be there. The
 * descriptions are for the picker only.
 *
 * Sources: FOIA exemptions at 5 U.S.C. § 552(b); Privacy Act exemptions at
 * 5 U.S.C. § 552a(d), (j) and (k).
 */

export interface ExemptionCode {
    code: string;
    label: string;
}

export interface ExemptionCodeSet {
    id: string;
    name: string;
    citation: string;
    codes: ExemptionCode[];
}

export const EXEMPTION_CODE_SETS: ExemptionCodeSet[] = [
    {
        id: "foia",
        name: "US FOIA",
        citation: "5 U.S.C. § 552(b)",
        codes: [
            { code: "(b)(1)", label: "Classified for national defense or foreign policy" },
            { code: "(b)(2)", label: "Internal agency personnel rules and practices" },
            { code: "(b)(3)", label: "Withheld under another statute" },
            { code: "(b)(4)", label: "Trade secrets, commercial or financial information" },
            { code: "(b)(5)", label: "Privileged inter- or intra-agency communications" },
            { code: "(b)(6)", label: "Personnel or medical files — personal privacy" },
            { code: "(b)(7)(A)", label: "Law enforcement — would interfere with proceedings" },
            { code: "(b)(7)(B)", label: "Law enforcement — would deprive of a fair trial" },
            { code: "(b)(7)(C)", label: "Law enforcement — personal privacy" },
            { code: "(b)(7)(D)", label: "Law enforcement — confidential source" },
            { code: "(b)(7)(E)", label: "Law enforcement — techniques and procedures" },
            { code: "(b)(7)(F)", label: "Law enforcement — would endanger life or safety" },
            { code: "(b)(8)", label: "Financial institution examination reports" },
            { code: "(b)(9)", label: "Geological information about wells" },
        ],
    },
    {
        id: "privacy-act",
        name: "US Privacy Act",
        citation: "5 U.S.C. § 552a",
        codes: [
            { code: "(d)(5)", label: "Compiled in anticipation of civil action" },
            { code: "(j)(1)", label: "Central Intelligence Agency records" },
            { code: "(j)(2)", label: "Criminal law enforcement records" },
            { code: "(k)(1)", label: "Classified national defense or foreign policy" },
            { code: "(k)(2)", label: "Investigatory material — law enforcement" },
            { code: "(k)(3)", label: "Secret Service protective services" },
            { code: "(k)(4)", label: "Statistical records" },
            { code: "(k)(5)", label: "Investigatory material — federal employment" },
            { code: "(k)(6)", label: "Testing or examination material" },
            { code: "(k)(7)", label: "Armed forces promotion evaluation material" },
        ],
    },
];

/** Flat lookup so a saved code can be described without re-scanning the sets. */
export const EXEMPTION_CODE_LABELS: Record<string, string> = Object.fromEntries(
    EXEMPTION_CODE_SETS.flatMap(set => set.codes.map(c => [c.code, c.label])),
);
