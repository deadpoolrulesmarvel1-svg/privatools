import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * pdf.js compiles a PDF's PostScript (Type 4) functions with `new Function`
 * unless the document load passes `isEvalSupported: false`. The production
 * CSP allows no eval, so such a PDF logged a script-src violation, and pdf.js
 * fell back to its interpreter anyway. Every load asks for the interpreter.
 */
const root = process.cwd();

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

/** The argument text of each `getDocument(…)` call; a typed declaration is not a call. */
function documentLoads(text: string): string[] {
    const loads: string[] = [];
    for (const match of text.matchAll(/\bgetDocument\s*\(/g)) {
        const start = match.index! + match[0].length;
        let depth = 1, end = start;
        for (; end < text.length && depth > 0; end++) {
            if (text[end] === "(") depth++;
            else if (text[end] === ")") depth--;
        }
        const args = text.slice(start, end - 1);
        if (!/^\s*\w+\??\s*:/.test(args)) loads.push(args);
    }
    return loads;
}

describe("pdf.js document loads", () => {
    const loads = sources(join(root, "src")).flatMap(path =>
        documentLoads(readFileSync(path, "utf8")).map(args => ({ file: relative(root, path), args })));

    it("are found, so the check below is not empty", () => {
        expect(loads.length).toBeGreaterThanOrEqual(10);
    });

    it("never let pdf.js compile a PDF's functions with eval", () => {
        expect(loads.filter(load => !/\bisEvalSupported:\s*false\b/.test(load.args))
            .map(load => `${load.file}: getDocument(${load.args.replace(/\s+/g, " ").trim()})`)).toEqual([]);
    });
});
