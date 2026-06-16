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
        const manifest = JSON.parse(readFileSync(join(root, "public/manifest.json"), "utf8")) as { description: string };
        const statusBar = readFileSync(join(root, "src/components/StatusBar.tsx"), "utf8");
        const staticSurfaces = [
            indexHtml,
            manifest.description,
            statusBar,
        ].join("\n");

        expect(staticSurfaces).not.toContain("All processing happens on your device");
        expect(staticSurfaces).not.toContain("All processing happens locally");
        expect(staticSurfaces).not.toContain("Zero uploads");
        expect(staticSurfaces).not.toContain("Zero analytics scripts");
        expect(staticSurfaces).not.toContain("Your files never touch our disk");
        expect(indexHtml).toContain("Browser-only when possible");
        expect(indexHtml).toContain("isolated");
        expect(manifest.description).toContain("Browser-only when possible");
        expect(manifest.description).toContain("isolated");
        expect(statusBar).toContain("Browser-only where possible");
        expect(statusBar).toContain("isolated backend");
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
