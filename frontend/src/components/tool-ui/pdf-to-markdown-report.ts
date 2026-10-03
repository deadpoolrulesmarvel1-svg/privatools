/**
 * PDF to Markdown's report: what the server found in one PDF, sent in the
 * X-Markdown-Report header (backend/app/services/pdf_to_markdown_service.py,
 * report_header), and the words the result uses for it.
 */
import { formatFileSize } from "@/lib/api";
import type { FileEntry } from "@/hooks/useMultiFileProcessor";

/** The server's page limit (pdf_to_markdown_service.MAX_PAGES): stated here, enforced there. */
export const MAX_PAGES = 1000;

/** The server's answer to a PDF with no text layer at all (pdf_to_markdown_service.SCAN_MESSAGE,
 *  which a backend test holds equal). The page answers it with a link to OCR PDF. */
export const SCAN_MESSAGE = "This PDF's pages are pictures without a text layer, as a scan's are, so there is nothing to convert yet. "
    + "Run the file through OCR PDF first, then convert the result.";

export interface MarkdownReport {
    pages: number;
    headings: number;
    tables: number;
    listItems: number;
    codeBlocks: number;
    images: number;
    links: number;
    /** The first 20 pages without a text layer; the count says how many in all. */
    pagesWithoutText: number[];
    pagesWithoutTextCount: number;
    pagesNotRead: number[];
    pagesNotReadCount: number;
    /** Pages from which repeated headers or footers were removed. */
    headersFootersRemoved: number;
    /** Up to three of the removed lines, as printed. */
    removedLines: string[];
    chunks: number;
    characters: number;
}

/** The report a finished file's answer carried, or null if it carried none. */
export function readReport(entry: Pick<FileEntry, "headers">): MarkdownReport | null {
    const raw = entry.headers?.["x-markdown-report"];
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<MarkdownReport>;
        return typeof value.pages === "number" ? value as MarkdownReport : null;
    } catch {
        return null;
    }
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "4", "4 and 7", "4, 7 and 9", with "and N more" past the pages the report lists. */
export function pageList(pages: number[], total = pages.length): string {
    const shown = pages.map(String);
    if (total > pages.length) return `${shown.join(", ")} and ${total - pages.length} more`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0] ?? "";
}

/** One line for a converted file's row: what it held, then its size. */
export function reportSummary(report: MarkdownReport | null, size: number): string {
    if (!report) return formatFileSize(size);
    const parts = [count(report.pages, "page")];
    if (report.headings) parts.push(count(report.headings, "heading"));
    if (report.tables) parts.push(count(report.tables, "table"));
    if (report.listItems) parts.push(count(report.listItems, "list item"));
    if (report.codeBlocks) parts.push(count(report.codeBlocks, "code block"));
    if (report.images) parts.push(count(report.images, "image placeholder"));
    if (report.links) parts.push(count(report.links, "link"));
    if (report.chunks > 1) parts.push(count(report.chunks, "chunk"));
    parts.push(formatFileSize(size));
    return parts.join(" · ");
}
