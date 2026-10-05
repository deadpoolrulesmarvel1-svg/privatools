/**
 * Form Creator's "Detect fields": what the server proposes, and how a
 * proposal becomes a field the visitor placed.
 *
 * /form-creator/detect (backend/app/services/_form_detect_worker.py) reads
 * what a PDF drawn as a form draws and says, and answers with candidates in
 * the numbers /form-creator takes. Nothing here creates anything: a
 * proposal turns into a field only when the visitor accepts it.
 */
import { getErrorDetail, getErrorStatus } from "@/lib/api";
import { friendlyError } from "@/lib/utils";

export type ProposalType = "text" | "checkbox" | "signature" | "date";

/** One candidate, as the route sends it. */
export interface DetectedCandidate {
    id: string;
    page: number;
    x: number; y: number; width: number; height: number;
    type: ProposalType;
    name: string;
    label: string;
    /** A heuristic score from 0 to 1 that orders candidates; not a probability. */
    confidence: number;
    multiline: boolean;
}

export interface DetectReport {
    pages: number;
    candidates: DetectedCandidate[];
    truncated: boolean;
    scanPages: number[];
    complexPages: number[];
    pagesNotChecked: number[];
    existingFields: number;
}

/** A candidate the visitor is reviewing: its name and type can be edited first. */
export interface Proposal extends DetectedCandidate {
    key: string;
}

export const PROPOSAL_TYPES: { value: ProposalType; label: string }[] = [
    { value: "text", label: "Text" },
    { value: "date", label: "Date" },
    { value: "checkbox", label: "Checkbox" },
    { value: "signature", label: "Signature" },
];

/** At or above this, a candidate is called "Likely"; below it, "Possible". */
export const LIKELY = 0.8;

export function proposalKey(candidate: DetectedCandidate, run: number): string {
    return `proposal-${run}-${candidate.id}`;
}

type Box = { page: number; x: number; y: number; width: number; height: number };

function overlap(a: Box, b: Box): number {
    if (a.page !== b.page) return 0;
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

/** Whether two boxes are the same place: most of the smaller one lies in the other. */
export function samePlace(a: Box, b: Box): boolean {
    const shared = overlap(a, b);
    return shared > 0 && shared >= 0.5 * Math.min(a.width * a.height, b.width * b.height);
}

/** The candidates not already placed: detecting again after accepting some
 * must not propose the same blanks twice. */
export function newCandidates(report: DetectReport, placed: Box[]): DetectedCandidate[] {
    return report.candidates.filter(c => !placed.some(p => samePlace(c, p)));
}

/** `name`, or the first of name_2, name_3… that no field uses yet. */
export function uniqueName(name: string, taken: Set<string>): string {
    const base = name.trim() || "field";
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}_${n}`;
    taken.add(candidate);
    return candidate;
}

const round = (value: number) => String(Math.round(value * 10) / 10);

/** The field a proposal becomes once accepted. A date is a text field: the
 * form has no date type. */
export function fieldFromProposal(p: Proposal, name: string) {
    return {
        name,
        type: (p.type === "date" ? "text" : p.type) as "text" | "checkbox" | "signature",
        page: String(p.page),
        x: round(p.x), y: round(p.y), width: round(p.width), height: round(p.height),
        multiline: p.multiline && p.type !== "checkbox" && p.type !== "signature",
    };
}

const pages = (list: number[]) => list.length === 1 ? `Page ${list[0]}` : `Pages ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The line that says what detection found. */
export function detectSummary(report: DetectReport, proposed: number): string {
    if (!report.candidates.length) {
        return "No likely fields were found. Detection looks for lines after labels, boxes, table cells and checkboxes that the PDF draws; this one may lay its blanks out another way. Place the fields by hand: choose Draw a field and drag a box on the page.";
    }
    const onPages = new Set(report.candidates.map(c => c.page)).size;
    if (!proposed) return `Found ${plural(report.candidates.length, "possible field")}, all of them already placed.`;
    return `Found ${plural(proposed, "possible field")} on ${plural(onPages, "page")}. They are dashed on the page and listed with the fields. Accept, edit or reject each one: only accepted fields go into the form.`;
}

/** What detection could not read, or left alone, page by page. */
export function detectNotes(report: DetectReport): string[] {
    const notes: string[] = [];
    if (report.scanPages.length) {
        notes.push(`${pages(report.scanPages)} ${report.scanPages.length === 1 ? "is a picture" : "are pictures"}, as scanned pages are, so nothing could be found there. Place fields on ${report.scanPages.length === 1 ? "it" : "them"} by hand.`);
    }
    if (report.complexPages.length) {
        notes.push(`${pages(report.complexPages)} ${report.complexPages.length === 1 ? "draws" : "draw"} too much to read ${report.complexPages.length === 1 ? "its" : "their"} lines and boxes; only typed blanks and checkbox characters were looked for there.`);
    }
    if (report.pagesNotChecked.length) {
        notes.push(`${pages(report.pagesNotChecked)} could not be read, so ${report.pagesNotChecked.length === 1 ? "it was" : "they were"} not checked.`);
    }
    if (report.truncated) {
        notes.push(`More fields were found than one form can take; the ${report.candidates.length} most likely are proposed.`);
    }
    return notes;
}

/** The words for a detection that failed. A 413 or 422 carries the server's
 * own explanation (too many pages, a scan, too much work), shown as written;
 * anything else goes through the shared advice. */
export function detectFailure(error: unknown): string {
    const status = getErrorStatus(error);
    const detail = getErrorDetail(error);
    if ((status === 413 || status === 422) && detail) return detail;
    const message = error instanceof Error ? error.message : "";
    return friendlyError(message, "Couldn't look for fields in this PDF. Try again, or place the fields by hand.");
}
