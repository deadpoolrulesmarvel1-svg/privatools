import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function listSourceFiles(dir: string): string[] {
    const abs = join(root, dir);
    const out: string[] = [];
    for (const entry of readdirSync(abs)) {
        const full = join(abs, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) out.push(...listSourceFiles(relative(root, full)));
        else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
    }
    return out;
}

describe("API client usage", () => {
    it("routes app backend submissions through the shared API client", () => {
        const allowedRawFetch = new Set([
            "src/components/BackendStatusBanner.tsx",
            "src/lib/api.ts",
        ]);
        const files = [
            ...listSourceFiles("src/components"),
            ...listSourceFiles("src/pages"),
            ...listSourceFiles("src/hooks"),
            ...listSourceFiles("src/lib"),
        ];

        const offenders = files
            .map((file) => ({
                rel: relative(root, file),
                text: readFileSync(file, "utf8"),
            }))
            .filter(({ rel }) => !allowedRawFetch.has(rel))
            .filter(({ text }) =>
                /const\s+API_BASE\s*=\s*["']\/api["']/.test(text)
                || /fetch\s*\(\s*(["'`])\/api\//.test(text)
                || /fetch\s*\(\s*`\$\{\s*API_BASE\s*\}\//.test(text)
            )
            .map(({ rel }) => rel);

        expect(offenders).toEqual([]);
    });
});
