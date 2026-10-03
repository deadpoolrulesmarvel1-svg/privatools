import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every tool surface that processes something must report a `tool_run`, or
 * the usage numbers silently undercount the catalogue. The shared engines
 * report centrally; everything else that talks to the backend, plus the
 * browser-only tools with an explicit run action, must call emitToolRun.
 * Tools whose output updates live as you type are counted by page view only.
 * A report that can be a failure must also say why: pass the caught error as
 * the second argument, or name the category with `errorKind`.
 */
const root = process.cwd();
const ENGINES = [
    "src/components/tool-ui/GenericUI.tsx",
    "src/components/tool-ui/SimpleConvertUI.tsx",
    "src/components/tool-ui/media/useMediaJob.ts",
    "src/hooks/useMultiFileProcessor.ts",
];
const BROWSER_ONLY_RUNNERS = [
    "src/components/tool-ui/SummarizePdfUI.tsx",
    "src/components/tool-ui/ChatPdfUI.tsx",
    "src/components/tool-ui/TranscribeAudioUI.tsx",
    "src/components/tool-ui/SubtitleGeneratorUI.tsx",
    "src/components/tool-ui/SubtitleTranslatorUI.tsx",
    "src/components/tool-ui/SubtitleConverterUI.tsx",
    "src/components/tool-ui/JsonXmlFormatterUI.tsx",
    "src/components/tool-ui/TextDiffUI.tsx",
    "src/components/tool-ui/HashGeneratorUI.tsx",
    "src/components/tool-ui/CsvJsonUI.tsx",
    "src/components/tool-ui/AiTokenCounterUI.tsx",
];
/** Files whose only backend call is the per-file worker handed to useMultiFileProcessor, which reports for them. */
const ENGINE_WORKERS = ["src/components/tool-ui/RemoveExifUI.tsx"];
const BACKEND_CALL = /\b(uploadFile|uploadFiles|uploadFileWithProgress|uploadFilesWithProgress|uploadFileGetJson|postFormData|processAndDownload|processFilesAndDownload)\s*\(/;

/** Workflow pages that report runs themselves. */
const WORKFLOW_PAGES = ["src/pages/BatchPage.tsx", "src/pages/PipelinePage.tsx"];
/**
 * Failure reports without a cause. Other work on this tool was in flight
 * when failure categories arrived (2026-09-24); pass the caught error as
 * emitToolRun's second argument there, then remove the entry.
 */
const FAILURE_CAUSE_PENDING: string[] = [];

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** The argument text of every emitToolRun(...) call in a source file. */
function emitCalls(source: string): string[] {
    const calls: string[] = [];
    for (let at = source.indexOf("emitToolRun("); at !== -1; at = source.indexOf("emitToolRun(", at + 1)) {
        let depth = 0;
        let end = at + "emitToolRun".length;
        for (; end < source.length; end++) {
            if (source[end] === "(") depth++;
            else if (source[end] === ")" && --depth === 0) break;
        }
        calls.push(source.slice(at + "emitToolRun(".length, end));
    }
    return calls;
}

/** A run that can fail must say why: a cause as the second argument, or an explicit errorKind. */
function reportsWhy(args: string): boolean {
    const text = args.trim();
    if (!text.startsWith("{")) return true;
    let depth = 0;
    let end = 0;
    for (; end < text.length; end++) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}" && --depth === 0) break;
    }
    const detail = text.slice(0, end + 1);
    if (/\boutcome\s*:\s*["']success["']/.test(detail)) return true;
    return /\berrorKind\s*:/.test(detail) || text.slice(end + 1).trim().startsWith(",");
}

describe("tool_run coverage", () => {
    it("every tool surface that processes files reports its run", () => {
        const files = walk(join(root, "src/components/tool-ui"))
            .map(file => relative(root, file))
            .filter(rel => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !ENGINES.includes(rel) && !ENGINE_WORKERS.includes(rel));
        const offenders = files.filter(rel => {
            const source = readFileSync(join(root, rel), "utf8");
            return (BACKEND_CALL.test(source) || BROWSER_ONLY_RUNNERS.includes(rel)) && !source.includes("emitToolRun(");
        });
        expect(offenders).toEqual([]);
    });
    it("the shared engines report their runs", () => {
        for (const rel of ENGINES) expect(readFileSync(join(root, rel), "utf8")).toContain("emitToolRun(");
    });
    it("every failure report passes its cause or names its category", () => {
        const files = [...walk(join(root, "src/components/tool-ui")).map(file => relative(root, file)), ...ENGINES, ...WORKFLOW_PAGES]
            .filter((rel, index, all) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && all.indexOf(rel) === index)
            .filter(rel => !FAILURE_CAUSE_PENDING.includes(rel));
        const offenders = files.flatMap(rel => emitCalls(readFileSync(join(root, rel), "utf8"))
            .filter(args => !reportsWhy(args))
            .map(args => `${rel}: emitToolRun(${args.replace(/\s+/g, " ").trim()})`));
        expect(offenders).toEqual([]);
    });
    it("recognizes failure reports with and without a cause", () => {
        expect(reportsWhy('{ outcome: "success", files: 1 }')).toBe(true);
        expect(reportsWhy('{ outcome: "error", files: 1 }, e')).toBe(true);
        expect(reportsWhy('{ outcome: "error", errorKind: "bad_input" }')).toBe(true);
        expect(reportsWhy('{ mode: "single", outcome, files: done + failed }, firstFailure')).toBe(true);
        expect(reportsWhy('{ outcome: "error", files: 1 }')).toBe(false);
        expect(reportsWhy("{outcome:'error',files:files?files.length:1}")).toBe(false);
        expect(reportsWhy("{ outcome, files: done + failed }")).toBe(false);
    });
});
