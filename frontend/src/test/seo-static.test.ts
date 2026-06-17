import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOTAL_TOOL_COUNT } from "@/data/site-stats";

const root = process.cwd();

const staleStorageClaims = [
    "temp memory",
    "temporary memory",
    "temporary server memory",
    "memory only",
    "processed in memory",
    "self-hostable via Docker, so files stay on your own infrastructure",
    "never written to disk",
    "Your files never touch our disk",
    "No copy is kept on any disk",
] as const;

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
        const landingPage = readFileSync(join(root, "src/pages/LandingPage.tsx"), "utf8");
        const staticSurfaces = [
            indexHtml,
            manifest.description,
            statusBar,
            landingPage,
        ].join("\n");

        expect(staticSurfaces).not.toContain("All processing happens on your device");
        expect(staticSurfaces).not.toContain("All processing happens locally");
        expect(staticSurfaces).not.toContain("Zero uploads");
        expect(staticSurfaces).not.toContain("Zero analytics scripts");
        expect(staticSurfaces).not.toContain("Your files never touch our disk");
        expect(staticSurfaces).not.toContain("No cloud uploads. No tracking.");
        expect(staticSurfaces).not.toContain("No Tracking");
        expect(indexHtml).toContain("Browser-only when possible");
        expect(indexHtml).toContain("isolated");
        expect(manifest.description).toContain("Browser-only when possible");
        expect(manifest.description).toContain("isolated");
        expect(statusBar).toContain("Browser-only where possible");
        expect(statusBar).toContain("isolated backend");
        expect(landingPage).toContain("Browser-only where possible");
        expect(landingPage).toContain("isolated temporary processing");
    });

    it("keeps static privacy storage claims aligned with temp-file processing", () => {
        const surfaces = [
            readFileSync(join(root, "public/llms.txt"), "utf8"),
            readFileSync(join(root, "src/pages/AboutPage.tsx"), "utf8"),
            readFileSync(join(root, "src/pages/LandingPage.tsx"), "utf8"),
            readFileSync(join(root, "src/pages/PrivacyPage.tsx"), "utf8"),
            readFileSync(join(root, "src/pages/TermsPage.tsx"), "utf8"),
            readFileSync(join(root, "src/components/DynamicHead.tsx"), "utf8"),
            readFileSync(join(root, "scripts/gen-llms.mjs"), "utf8"),
        ].join("\n");

        for (const stale of staleStorageClaims) {
            expect(surfaces).not.toContain(stale);
        }
        expect(surfaces).toContain("temporary per-request storage");
        expect(surfaces).toContain("isolated temporary");
    });

    it("does not describe hosted tool processing as the user's own infrastructure", () => {
        const toolPageSurfaces = [
            readFileSync(join(root, "src/pages/ToolPage.tsx"), "utf8"),
            readFileSync(join(root, "src/pages/NonPdfToolPage.tsx"), "utf8"),
            readFileSync(join(root, "src/components/DynamicHead.tsx"), "utf8"),
        ].join("\n");

        expect(toolPageSurfaces).not.toContain("Processed on your own infrastructure");
        expect(toolPageSurfaces).not.toContain("Files go to your self-hosted server");
        expect(toolPageSurfaces).not.toContain("Files are processed on the self-hosted server");
        expect(toolPageSurfaces).not.toContain("Self-hostable so your files stay on your own infrastructure");
        expect(toolPageSurfaces).not.toContain("self-hostable, so files stay on your own infrastructure");
        expect(toolPageSurfaces).toContain("Processed in isolated temporary storage");
        expect(toolPageSurfaces).toContain("never on third-party clouds");
        expect(toolPageSurfaces).toContain("self-hostable on your own infrastructure");
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

    it("keeps generated AI and search files aligned with the current tool count", () => {
        const generated = [
            readFileSync(join(root, "public/llms.txt"), "utf8"),
            readFileSync(join(root, "public/llms-full.txt"), "utf8"),
            readFileSync(join(root, "public/blog-content.json"), "utf8"),
            readFileSync(join(root, "public/opensearch.xml"), "utf8"),
        ].join("\n");

        expect(generated).toContain(`${TOTAL_TOOL_COUNT} tools`);
        expect(generated).toContain(`Search ${TOTAL_TOOL_COUNT} free`);
        expect(generated).not.toContain(`${TOTAL_TOOL_COUNT}+`);
        expect(generated).not.toMatch(/AES encryption/i);
        expect(generated).not.toMatch(/\b152\b|175\+|Tools:<\/strong> 107/);
    });

    it("keeps production CSP compatible with browser-side AI tools", () => {
        const deployConfigs = [
            readFileSync(join(root, "..", "deploy/oracle-vm/nginx-privatools.conf"), "utf8"),
            readFileSync(join(root, "..", "deploy/nginx.conf"), "utf8"),
        ];

        for (const config of deployConfigs) {
            expect(config).toContain("'unsafe-eval'");
            expect(config).toContain("https://huggingface.co");
            expect(config).toContain("https://cdn.jsdelivr.net");
            expect(config).toContain("worker-src 'self' blob:");
            expect(config).toContain("https://fonts.bunny.net");
        }
    });

    it("keeps deploy security headers aligned with the backend policy", () => {
        const deployConfigs = [
            readFileSync(join(root, "..", "deploy/oracle-vm/nginx-privatools.conf"), "utf8"),
            readFileSync(join(root, "..", "deploy/nginx.conf"), "utf8"),
        ];

        for (const config of deployConfigs) {
            expect(config).toContain('add_header X-Frame-Options "DENY" always;');
            expect(config).not.toContain('X-Frame-Options "SAMEORIGIN"');
            expect(config).toContain('Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"');
            expect(config).not.toContain('Strict-Transport-Security "max-age=31536000');
        }
    });
});
