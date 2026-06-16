import { describe, expect, it } from "vitest";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { getToolEndpoint } from "@/lib/tool-endpoints";

const allTools = [...tools, ...nonPdfTools];

describe("tool registry quality", () => {
    it("does not ship duplicate tool slugs", () => {
        const seen = new Set<string>();
        const duplicates = new Set<string>();

        for (const tool of allTools) {
            if (seen.has(tool.slug)) duplicates.add(tool.slug);
            seen.add(tool.slug);
        }

        expect([...duplicates]).toEqual([]);
    });

    it("does not expose placeholder tools in production metadata", () => {
        const placeholders = allTools.filter(tool => tool.comingSoon).map(tool => tool.slug);
        expect(placeholders).toEqual([]);
    });

    it("has complete public-facing metadata for every tool", () => {
        const incomplete = allTools
            .filter(tool => {
                const hasSearchText = Boolean(tool.synonyms?.trim());
                const hasDescription = tool.description.trim().length >= 12
                    && tool.longDescription.trim().length > tool.description.trim().length;
                const hasOutputMetadata = tool.outputLabel.trim().length > 0;
                return !tool.slug || !tool.name.trim() || !hasSearchText || !hasDescription || !hasOutputMetadata;
            })
            .map(tool => tool.slug);

        expect(incomplete).toEqual([]);
    });

    it("does not overclaim unlimited file sizes in tool metadata", () => {
        const overclaims = allTools
            .filter(tool => /no file size limits/i.test(`${tool.description}\n${tool.longDescription}`))
            .map(tool => tool.slug);

        expect(overclaims).toEqual([]);
    });

    it("maps every server-backed tool to an API endpoint path", () => {
        const missing = allTools
            .filter(tool => !tool.clientOnly)
            .filter(tool => !getToolEndpoint(tool.slug).startsWith("/"))
            .map(tool => tool.slug);

        expect(missing).toEqual([]);
    });
});
