/**
 * Tool counts, from the registry.
 *
 * The designs shipped their own figures — "200+ tools", "107 tools", and a
 * category table claiming 12 archive tools against a real 2 and 22 document
 * tools against a real 2. Every number in it was invented, which is what a
 * design source is for and exactly what must not survive into the product.
 *
 * CLAUDE.md puts it plainly: the total is `tools.length + nonPdfTools.length`
 * and never a literal. The site once advertised 221 when it had 219.
 */

import { tools } from "@/data/tools";
import { nonPdfTools, type NonPdfTool } from "@/data/non-pdf-tools";

export const TOOL_TOTAL = tools.length + nonPdfTools.length;
export const PDF_COUNT = tools.length;
export const NON_PDF_COUNT = nonPdfTools.length;

function inCategory(category: string): number {
    return nonPdfTools.filter((t: NonPdfTool) => t.category === category).length;
}

/**
 * The category rail Structured renders, with counts that are true.
 *
 * Icons and colours are the design's; only the numbers changed. Two structural
 * corrections came with them:
 *
 * - Video and Audio were two rows. The registry has one `video-audio`
 *   category, and separating them would mean guessing from slugs — inventing a
 *   number and presenting it as fact, which is the original sin here. They are
 *   one row, as they are in the house theme.
 * - Developer was missing entirely, despite being the third-largest family.
 *   The design had no row for 26 tools.
 */
export const STRUCTURED_CATEGORIES: ReadonlyArray<
    readonly [label: string, icon: string, colour: string, meta: string]
> = [
    ["PDF", "picture_as_pdf", "var(--coral)", `${PDF_COUNT} tools`],
    ["Images", "image", "var(--blue)", `${inCategory("image")} tools`],
    ["Video & audio", "movie", "var(--violet)", `${inCategory("video-audio")} tools`],
    ["Developer", "code", "var(--teal)", `${inCategory("developer")} tools`],
    ["Archives", "folder_zip", "var(--amber)", `${inCategory("archive")} tools`],
    ["Documents & Data", "table_chart", "var(--em)", `${inCategory("document-office")} tools`],
    // Task families cut across categories, so they carry no count — the design
    // already used a non-numeric label here and that part was right.
    ["Converters", "swap_horiz", "var(--blue)", "Task family"],
    ["Editors", "edit_document", "var(--violet)", "Task family"],
    ["Security", "shield_lock", "var(--em)", "Task family"],
];
