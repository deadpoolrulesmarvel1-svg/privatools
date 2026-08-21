import { describe, it, expect } from "vitest";
import { allChainSlugs, nextStepsFor } from "@/lib/tool-chains";
import { toolBySlug } from "@/data/tools";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";

describe("result chaining", () => {
    it("every slug a chain references actually exists", () => {
        // Same drift class as the six slug registries: a suggestion pointing at
        // a renamed or removed tool renders a dead link on a success screen.
        const missing = allChainSlugs().filter(
            slug => !toolBySlug[slug] && !nonPdfToolBySlug[slug],
        );
        expect(missing, `chains reference tools that don't exist: ${missing}`).toEqual([]);
    });

    it("suggests follow-ups after a merge", () => {
        const steps = nextStepsFor("merge-pdf", "merged.pdf");
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.map(s => s.slug)).toContain("compress-pdf");
    });

    it("never suggests the tool you just used", () => {
        for (const slug of allChainSlugs()) {
            const steps = nextStepsFor(slug, "out.pdf");
            expect(steps.map(s => s.slug)).not.toContain(slug);
        }
    });

    it("offers nothing when the output is not a PDF", () => {
        // Handing "Merge PDF" a JPG gives the next tool a file it cannot open,
        // which is worse than offering nothing at all.
        expect(nextStepsFor("pdf-to-image", "page.jpg")).toEqual([]);
        expect(nextStepsFor("compress-pdf", "archive.zip")).toEqual([]);
        expect(nextStepsFor("pdf-to-word", "doc.docx")).toEqual([]);
    });

    it("recognises a PDF whatever the case of the extension", () => {
        expect(nextStepsFor("merge-pdf", "MERGED.PDF").length).toBeGreaterThan(0);
    });

    it("falls back to a sensible chain for a tool with no curated one", () => {
        const steps = nextStepsFor("some-tool-with-no-chain", "out.pdf");
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.every(s => s.reason.length > 0)).toBe(true);
    });

    it("gives every suggestion a reason, not just a name", () => {
        // "Compress PDF" alone is a menu. The reason is what makes it an answer.
        for (const slug of ["merge-pdf", "ocr-pdf", "redact-pdf", "unknown-slug"]) {
            for (const step of nextStepsFor(slug, "out.pdf")) {
                expect(step.reason.trim().length).toBeGreaterThan(10);
                expect(step.name.trim().length).toBeGreaterThan(0);
            }
        }
    });

    it("builds hrefs that match each registry's route shape", () => {
        for (const slug of allChainSlugs()) {
            for (const step of nextStepsFor(slug, "out.pdf")) {
                const expected = toolBySlug[step.slug] ? `/tool/${step.slug}` : `/tools/${step.slug}`;
                expect(step.href).toBe(expected);
            }
        }
    });

    it("respects the limit", () => {
        expect(nextStepsFor("merge-pdf", "out.pdf", 2)).toHaveLength(2);
        expect(nextStepsFor("merge-pdf", "out.pdf", 1)).toHaveLength(1);
    });

    it("returns no duplicate suggestions", () => {
        for (const slug of allChainSlugs()) {
            const slugs = nextStepsFor(slug, "out.pdf").map(s => s.slug);
            expect(new Set(slugs).size).toBe(slugs.length);
        }
    });

    it("never suggests a tool that cannot take a PDF", () => {
        for (const slug of allChainSlugs()) {
            for (const step of nextStepsFor(slug, "out.pdf")) {
                const tool = toolBySlug[step.slug];
                if (!tool) continue;
                expect(tool.accepts, `${step.slug} does not accept PDFs`).toContain(".pdf");
            }
        }
    });
});
