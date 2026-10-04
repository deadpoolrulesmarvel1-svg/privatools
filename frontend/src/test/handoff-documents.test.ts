/**
 * A file handed to another tool stays in the page that holds it.
 *
 * The hand-off lives only in this page's memory (lib/file-handoff.ts).
 * navigateTo loads a new document when the next page needs a capability this
 * one's Content Security Policy lacks (skins/cspRoutes.ts, documentNavigationFor),
 * and that load drops the file: the next tool opens empty. So every place that
 * offers to carry a file on must lead to a page this document can show. None
 * crossed on 2026-10-03 except Image to PDF's chain to OCR PDF, which no page
 * showed, because Image to PDF's own screen has no next steps.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { nextStepsFor } from "@/lib/tool-chains";
import { documentNavigationFor } from "@/skins/cspRoutes";
import { fileSuggestions, toolHref } from "@/skins/daylight/consumer/catalogue";

describe("hand-offs stay in the document that holds the file", () => {
    it("from the home page's suggestions for dropped files", () => {
        const dropped = ["a.pdf", "a.png", "a.jpg", "a.heic", "a.docx", "a.xlsx", "a.pptx", "a.odt", "a.md", "a.txt", "a.json", "a.epub", "a.rtf"];
        const offered: string[] = [];
        const crossing: string[] = [];
        for (const name of dropped) {
            for (const tool of fileSuggestions([new File(["synthetic"], name)])) {
                const href = toolHref(tool);
                offered.push(href);
                if (documentNavigationFor("/", href) !== null) crossing.push(`${name} -> ${href}`);
            }
        }
        expect(offered.length).toBeGreaterThan(dropped.length);
        expect(crossing).toEqual([]);
    });

    it("from each tool to the next steps its result screen offers", () => {
        const crossing: string[] = [];
        let offered = 0;
        for (const [prefix, list] of [["/tool/", tools], ["/tools/", nonPdfTools]] as const) {
            for (const tool of list) {
                for (const step of nextStepsFor(tool.slug, "result.pdf")) {
                    offered++;
                    if (documentNavigationFor(prefix + tool.slug, step.href) !== null) crossing.push(`${tool.slug} -> ${step.slug}`);
                }
            }
        }
        expect(offered).toBeGreaterThan(0);
        expect(crossing).toEqual([]);
    });
});
