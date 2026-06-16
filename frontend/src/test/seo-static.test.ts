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
});
