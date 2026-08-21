/**
 * What to offer a user once a tool has finished.
 *
 * `/pipeline` already chains 17 backend steps, and the file-handoff mechanism
 * already moves a file into another tool — but nothing ever offered either from
 * a *result* screen. The chaining existed and was unreachable at the exact
 * moment someone wants it.
 *
 * The competitor audit put this bluntly: DocHub's "what would you like to do
 * with this document?" completion modal was the single best idea in the whole
 * report, and it is the entire benefit of their editor model. This is the
 * stateless version — no account, no storage, just the file already in the
 * browser handed to the next tool.
 *
 * Suggestions carry a reason. "Compress PDF" alone is a menu; "now that pages
 * are merged, shrink the result for email" is an answer.
 */

import { toolBySlug } from "@/data/tools";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";

export interface NextStep {
    slug: string;
    name: string;
    href: string;
    reason: string;
}

type Suggestion = { slug: string; reason: string };

/** Sensible follow-ups for tools whose output is a PDF. */
const PDF_CHAINS: Record<string, Suggestion[]> = {
    "merge-pdf": [
        { slug: "compress-pdf", reason: "Merged files get big — shrink it for email" },
        { slug: "page-numbers", reason: "Number the combined document end to end" },
        { slug: "bates-numbering", reason: "Stamp it as one production set" },
    ],
    "split-pdf": [
        { slug: "compress-pdf", reason: "Shrink the pieces before sending" },
        { slug: "merge-pdf", reason: "Recombine a different selection" },
    ],
    "compress-pdf": [
        { slug: "protect-pdf", reason: "Add a password before you send it" },
        { slug: "merge-pdf", reason: "Combine it with other documents" },
        { slug: "watermark", reason: "Mark it as a draft or confidential" },
    ],
    "ocr-pdf": [
        { slug: "pdf-to-word", reason: "The text is searchable now — convert it" },
        { slug: "redact-pdf", reason: "Redaction needs a text layer to work on" },
        { slug: "accessibility-check", reason: "Check whether it reads properly now" },
    ],
    "rotate-pdf": [
        { slug: "compress-pdf", reason: "Shrink it for sending" },
        { slug: "merge-pdf", reason: "Combine with other documents" },
    ],
    "organize-pages": [
        { slug: "page-numbers", reason: "Renumber after reordering" },
        { slug: "compress-pdf", reason: "Shrink it for sending" },
    ],
    "redact-pdf": [
        { slug: "compress-pdf", reason: "Shrink the redacted copy" },
        { slug: "bates-numbering", reason: "Number it for production" },
        { slug: "protect-pdf", reason: "Lock the redacted version" },
    ],
    "unlock-pdf": [
        { slug: "compress-pdf", reason: "Shrink it now that it's editable" },
        { slug: "redact-pdf", reason: "Remove sensitive content" },
        { slug: "merge-pdf", reason: "Combine with other documents" },
    ],
    "watermark": [
        { slug: "compress-pdf", reason: "Shrink it before sending" },
        { slug: "protect-pdf", reason: "Add a password on top" },
    ],
    "bates-numbering": [
        { slug: "compress-pdf", reason: "Shrink the stamped set" },
        { slug: "protect-pdf", reason: "Lock the production copy" },
    ],
    "image-to-pdf": [
        { slug: "compress-pdf", reason: "Image PDFs are large — shrink it" },
        { slug: "ocr-pdf", reason: "Make the text in those images searchable" },
    ],
    "sign-pdf": [
        { slug: "protect-pdf", reason: "Lock it so the signature can't be moved" },
        { slug: "compress-pdf", reason: "Shrink it for sending" },
    ],
};

/** Fallback when a PDF-producing tool has no curated chain of its own. */
const DEFAULT_PDF_CHAIN: Suggestion[] = [
    { slug: "compress-pdf", reason: "Shrink it for email or upload" },
    { slug: "merge-pdf", reason: "Combine it with other documents" },
    { slug: "protect-pdf", reason: "Add a password" },
];

function resolve(slug: string): { name: string; href: string } | null {
    const pdfTool = toolBySlug[slug];
    if (pdfTool) return { name: pdfTool.name, href: `/tool/${slug}` };
    const other = nonPdfToolBySlug[slug];
    if (other) return { name: other.name, href: `/tools/${slug}` };
    // A suggestion pointing at a slug that no longer exists would render a
    // dead link. Drop it rather than ship one; the parity test asserts this
    // never actually happens.
    return null;
}

function isPdf(filename: string): boolean {
    return filename.toLowerCase().endsWith(".pdf");
}

/**
 * Follow-up tools for a finished job.
 *
 * Gated on the output actually being a PDF: suggesting "Merge PDF" after
 * PDF→JPG hands the next tool a file it cannot open, which is worse than
 * offering nothing.
 */
export function nextStepsFor(fromSlug: string, outputFilename: string, limit = 3): NextStep[] {
    if (!isPdf(outputFilename)) return [];

    const suggestions = PDF_CHAINS[fromSlug] ?? DEFAULT_PDF_CHAIN;
    const steps: NextStep[] = [];
    for (const s of suggestions) {
        if (s.slug === fromSlug) continue;  // never suggest the tool you just used
        const resolved = resolve(s.slug);
        if (!resolved) continue;
        steps.push({ slug: s.slug, name: resolved.name, href: resolved.href, reason: s.reason });
        if (steps.length >= limit) break;
    }
    return steps;
}

/** Every slug referenced by a chain — used by the test that keeps them honest. */
export function allChainSlugs(): string[] {
    const slugs = new Set<string>();
    for (const list of [...Object.values(PDF_CHAINS), DEFAULT_PDF_CHAIN]) {
        for (const s of list) slugs.add(s.slug);
    }
    for (const key of Object.keys(PDF_CHAINS)) slugs.add(key);
    return [...slugs];
}
