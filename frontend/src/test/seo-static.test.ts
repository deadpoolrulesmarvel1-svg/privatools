import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("static SEO files", () => {
    it("keeps render-critical assets crawlable", () => {
        const robots = readFileSync(join(root, "public/robots.txt"), "utf8");

        expect(robots).toContain("Sitemap: https://privatools.me/sitemap.xml");
        expect(robots).not.toMatch(/^\s*Disallow:\s*\/assets\/?\s*$/m);
    });

    it("does not overclaim that every tool is browser-only", () => {
        const indexHtml = readFileSync(join(root, "index.html"), "utf8");

        expect(indexHtml).not.toContain("All processing happens on your device");
        expect(indexHtml).not.toContain("All processing happens locally");
        expect(indexHtml).not.toContain("Zero uploads");
        expect(indexHtml).toContain("Browser-only when possible");
        expect(indexHtml).toContain("isolated");
    });

    it("leaves JSON-LD to the route-aware SEO layer", () => {
        const indexHtml = readFileSync(join(root, "index.html"), "utf8");

        expect(indexHtml).not.toMatch(/<script[^>]+type=["']application\/ld\+json["']/i);
    });

    it("keeps Create ZIP claims in llms-full aligned with server processing", () => {
        const llmsFull = readFileSync(join(root, "public/llms-full.txt"), "utf8");

        expect(llmsFull).not.toContain("Fast local compression with no file upload to external servers");
        expect(llmsFull).toContain("Fast compression in an isolated container, no third-party uploads");
    });
});
