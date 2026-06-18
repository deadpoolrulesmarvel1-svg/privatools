import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blogPosts } from "@/data/blog";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { TOTAL_TOOL_COUNT, TOOL_BREADTH_LABEL } from "@/data/site-stats";
import { getToolEndpoint } from "@/lib/tool-endpoints";

const allTools = [...tools, ...nonPdfTools];
const root = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "test") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            sourceFiles(path, out);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(path);
        }
    }
    return out;
}

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

    it("does not advertise unsupported Create ZIP password encryption", () => {
        const createZip = nonPdfTools.find(tool => tool.slug === "create-zip");
        const copy = `${createZip?.description}\n${createZip?.longDescription}`;

        expect(createZip).toBeDefined();
        expect(copy).not.toMatch(/password|encrypt|AES/i);
        expect(copy).toContain("isolated container");
    });

    it("keeps public tool-count claims aligned with the registry", () => {
        expect(TOTAL_TOOL_COUNT).toBe(allTools.length);
        expect(TOOL_BREADTH_LABEL).toBe(`${allTools.length} tools (PDF, image, video, audio, dev)`);

        const blogCopy = JSON.stringify(blogPosts);
        const comparePage = readFileSync(join(root, "src/pages/ComparePage.tsx"), "utf8");
        const dynamicHead = readFileSync(join(root, "src/components/DynamicHead.tsx"), "utf8");
        const aboutPage = readFileSync(join(root, "src/pages/AboutPage.tsx"), "utf8");
        const opensearch = readFileSync(join(root, "public/opensearch.xml"), "utf8");
        const currentSurfaces = [blogCopy, comparePage, dynamicHead, aboutPage, opensearch].join("\n");

        expect(blogCopy).toContain(`${TOTAL_TOOL_COUNT} tools`);
        expect(blogCopy).not.toMatch(/\b152\b|175\+|Tools:<\/strong> 107/);
        expect(currentSurfaces).not.toMatch(/175\+/);
        expect(comparePage).toContain("TOOL_BREADTH_LABEL");
        expect(opensearch).toContain(`Search ${TOTAL_TOOL_COUNT} free`);
    });

    it("maps every server-backed tool to an API endpoint path", () => {
        const missing = allTools
            .filter(tool => !tool.clientOnly)
            .filter(tool => !getToolEndpoint(tool.slug).startsWith("/"))
            .map(tool => tool.slug);

        expect(missing).toEqual([]);
    });

    it("keeps literal internal tool links on the matching route family", () => {
        const pdfSlugs = new Set(tools.map(tool => tool.slug));
        const nonPdfSlugs = new Set(nonPdfTools.map(tool => tool.slug));
        const mismatches: string[] = [];

        for (const file of sourceFiles(join(root, "src"))) {
            const text = readFileSync(file, "utf8");
            for (const match of text.matchAll(/\/tools?\/([a-z0-9-]+)/g)) {
                const [href, slug] = match;
                if (href.startsWith("/tool/") && !pdfSlugs.has(slug)) {
                    mismatches.push(`${file}: ${href} should use /tools/ or does not exist`);
                }
                if (href.startsWith("/tools/") && !nonPdfSlugs.has(slug)) {
                    mismatches.push(`${file}: ${href} should use /tool/ or does not exist`);
                }
            }
        }

        expect(mismatches).toEqual([]);
    });
});
