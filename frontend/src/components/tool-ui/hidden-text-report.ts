/**
 * The Hidden Text Checker's report: its shape (as /api/hidden-text-checker
 * sends it, from backend/app/services/_hidden_text_worker.py), what each
 * reason means, the verdict line, and the plain-text export.
 */

export type HiddenReason =
    | "invisible" | "transparent" | "same-colour" | "tiny" | "off-page" | "clipped"
    | "hidden-layer" | "covered" | "hidden-annotation" | "unapplied-redaction";

/** A box on the page as shown: [left, top, right, bottom], each a fraction of its width or height. */
export type HiddenBox = [number, number, number, number];

export interface HiddenFinding {
    page: number;
    reason: HiddenReason;
    /** The server's sentence saying how the text is hidden, e.g. "white text on a white page". */
    detail: string;
    text: string;
    /** The server quotes at most 2,000 characters of one finding. */
    truncated: boolean;
    words: number;
    boxes: HiddenBox[];
    size?: number | null;
    source?: "comment" | "form-field";
}

export interface OcrLayer {
    page: number;
    text: string;
    truncated: boolean;
    words: number;
    boxes: HiddenBox[];
}

export interface HiddenTextReport {
    pages: number;
    pagesChecked: number;
    summary: {
        findings: number;
        byReason: Record<HiddenReason, number>;
        wordsByReason: Record<HiddenReason, number>;
        pagesWithFindings: number[];
        ocrPages: number[];
    };
    findings: HiddenFinding[];
    findingsTruncated: boolean;
    ocr: OcrLayer[];
    notes: string[];
}

/** In the order the page lists them. */
export const REASON_ORDER: HiddenReason[] = [
    "same-colour", "invisible", "transparent", "tiny", "covered", "unapplied-redaction",
    "hidden-layer", "hidden-annotation", "off-page", "clipped",
];

export const REASON_LABELS: Record<HiddenReason, string> = {
    invisible: "Invisible text",
    transparent: "Transparent text",
    "same-colour": "Same colour as the background",
    tiny: "Too small to read",
    "off-page": "Off the page",
    clipped: "Clipped out of view",
    "hidden-layer": "In a hidden layer",
    covered: "Under a box or image",
    "hidden-annotation": "Hidden comment or form field",
    "unapplied-redaction": "Redaction never applied",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "1", "1 and 3", "1, 3 and 7", or a range when there are many. */
export function pageList(pages: number[]): string {
    const sorted = [...new Set(pages)].sort((a, b) => a - b);
    if (sorted.length <= 1) return sorted.join("");
    if (sorted.length > 8) return `${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} pages)`;
    return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

export function totalWords(report: HiddenTextReport): number {
    return Object.values(report.summary.wordsByReason).reduce((sum, n) => sum + n, 0);
}

export function verdict(report: HiddenTextReport): { found: boolean; title: string; detail: string } {
    const { findings, pagesWithFindings } = report.summary;
    const checked = report.pagesChecked;
    if (!findings) {
        return {
            found: false,
            title: "No hidden text found",
            detail: `None of these checks matched on the ${plural(checked, "page")} checked. That doesn't mean the file is safe in every way.`,
        };
    }
    const where = pagesWithFindings.length === 1 ? `page ${pageList(pagesWithFindings)}` : `pages ${pageList(pagesWithFindings)}`;
    return {
        found: true,
        title: "Hidden text found",
        detail: `${plural(findings, "finding")}, ${plural(totalWords(report), "word")}, on ${where}.`,
    };
}

/** A tool that removes what was found; `why` continues a sentence that starts with its name. */
export type NextStep = { slug: string; tool: string; why: string };

/** Tools that remove what was found, for the reasons present. */
export function nextSteps(report: HiddenTextReport): NextStep[] {
    const has = (reason: HiddenReason) => report.summary.byReason[reason] > 0;
    const steps: NextStep[] = [];
    if (has("covered") || has("unapplied-redaction")) {
        steps.push({ slug: "redact-pdf", tool: "Redact PDF", why: "deletes the text under the boxes you draw. Words under a box drawn on top are still in the file." });
    } else if (["invisible", "transparent", "same-colour", "tiny"].some(reason => has(reason as HiddenReason))) {
        steps.push({ slug: "redact-pdf", tool: "Redact PDF", why: "deletes text you can't see as well: draw a box over its highlighted place, and all text under the box is removed." });
    }
    if (has("hidden-layer")) {
        steps.push({ slug: "sanitize-pdf", tool: "Sanitize Document", why: "deletes what layers that are switched off hold, along with scripts and attachments." });
    }
    if (report.findings.some(f => f.reason === "hidden-annotation" && f.source === "comment")) {
        steps.push({ slug: "delete-annotations", tool: "Delete Annotations", why: "removes comments, including hidden ones." });
    }
    return steps;
}

/** The report as plain text, for pasting into a ticket or keeping with the file. */
export function reportToText(report: HiddenTextReport, filename: string, checkedAt: Date): string {
    const v = verdict(report);
    const lines = [
        "Hidden text report",
        `File: ${filename}`,
        `Checked: ${checkedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
        `Pages checked: ${report.pagesChecked} of ${report.pages}`,
        "",
        `${v.title}. ${v.detail}`,
    ];
    if (report.summary.findings) {
        for (const reason of REASON_ORDER) {
            const n = report.summary.byReason[reason];
            if (n) lines.push(`  ${REASON_LABELS[reason]}: ${n}`);
        }
        lines.push("", "Findings:");
        report.findings.forEach((f, i) => {
            lines.push(`${i + 1}. Page ${f.page}: ${REASON_LABELS[f.reason]}, ${f.detail}`);
            lines.push(`   "${f.text}"${f.truncated ? " (first 2,000 characters)" : ""}`);
        });
        if (report.findingsTruncated) lines.push(`Only the first ${report.findings.length.toLocaleString("en")} findings are listed.`);
    }
    if (report.ocr.length) {
        lines.push("", `OCR text layers (invisible text over page images, which OCR adds; not counted as hidden text): page${report.ocr.length === 1 ? "" : "s"} ${pageList(report.ocr.map(o => o.page))}`);
        for (const layer of report.ocr) lines.push(`  Page ${layer.page}: ${plural(layer.words, "word")}, starting "${layer.text.slice(0, 120)}${layer.text.length > 120 || layer.truncated ? "…" : ""}"`);
    }
    if (report.notes.length) {
        lines.push("", "Notes:", ...report.notes.map(note => `- ${note}`));
    }
    lines.push("", "A clean result means none of these checks matched, not that the file is safe in every way.",
        "Made with the PrivaTools Hidden Text Checker.");
    return lines.join("\n") + "\n";
}
