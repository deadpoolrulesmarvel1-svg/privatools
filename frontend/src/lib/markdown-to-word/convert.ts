/**
 * Markdown to Word, in this browser: Markdown in, a .docx out.
 *
 * The page loads this module when the visitor converts, and this module loads
 * Temml (LaTeX to MathML) only when the Markdown has equations, so neither
 * weighs on any other page. Nothing is sent anywhere: the document is built
 * from the text alone, and images are taken only from data: URIs in it.
 */
import { zipSync, type Zippable } from "fflate";
import { inlineText, parseMarkdown, type Block, type Inline, type MarkdownDocument } from "./markdown";
import { latexToOmml, type MathResult, type TemmlLike } from "./math";
import { DocxWriter, type ConversionReport } from "./docx";
import type { PageSize } from "./ooxml";

export type { ConversionReport, ReportedEquation, ReportedImage } from "./docx";
export type { PageSize } from "./ooxml";

/** The most Markdown converted at once: about ten megabytes of text, data: images included. */
export const MAX_MARKDOWN_CHARS = 10 * 1024 * 1024;

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface ConvertOptions {
    page: PageSize;
    /** The document's title; the first heading when left out. */
    title?: string;
    /** Once the Markdown is read: how many equations it holds. */
    onStart?: (equations: number) => void;
    /** How far the run has got, from 0 to 1. */
    onProgress?: (fraction: number) => void;
    /** Load Temml; tests pass their own. */
    loadTemml?: () => Promise<TemmlLike>;
    made?: Date;
}

export interface ConvertResult {
    blob: Blob;
    title: string;
    report: ConversionReport;
}

type MathNode = (Extract<Block, { type: "math" }> | Extract<Inline, { type: "math" }>);

/** Every equation in the document, in order. */
export function collectMath(document: MarkdownDocument): MathNode[] {
    const found: MathNode[] = [];
    const inlines = (nodes: Inline[]) => {
        for (const node of nodes) {
            if (node.type === "math") found.push(node);
            else if ("children" in node) inlines(node.children);
        }
    };
    const blocks = (list: Block[]) => {
        for (const block of list) {
            switch (block.type) {
                case "math": found.push(block); break;
                case "heading": case "paragraph": inlines(block.children); break;
                case "blockquote": blocks(block.children); break;
                case "list": for (const item of block.items) blocks(item.children); break;
                case "table": for (const row of [block.head, ...block.rows]) for (const cell of row) inlines(cell); break;
                default: break;
            }
        }
    };
    blocks(document.children);
    return found;
}

/** The first heading's text, for the document's title and file name. */
export function firstHeading(document: MarkdownDocument): string {
    const visit = (list: Block[]): string => {
        for (const block of list) {
            if (block.type === "heading") return inlineText(block.children).replace(/\s+/g, " ").trim();
            if (block.type === "blockquote") { const found = visit(block.children); if (found) return found; }
        }
        return "";
    };
    return visit(document.children);
}

/** A file name from a title or a source file's name: no characters Windows or macOS refuse, at most 80 of them. */
export function docxFileName(stem: string): string {
    // Bounded before the patterns, which would slow on a very long title, and cut to 80 after.
    // eslint-disable-next-line no-control-regex -- control characters are among those a file name can't hold
    const clean = stem.replace(/\.(md|markdown|txt)$/i, "").slice(0, 200).replace(/[\\/:*?"<>|\u{0}-\u{1f}]+/gu, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 80).trim();
    return `${clean || "document"}.docx`;
}

const loadTemml = async (): Promise<TemmlLike> => (await import("temml")).default;

/** Let the page paint and answer input every so often during a long run. */
function yielder() {
    let last = performance.now();
    return async () => {
        if (performance.now() - last < 40) return;
        await new Promise(resolve => setTimeout(resolve, 0));
        last = performance.now();
    };
}

export async function convertMarkdownToDocx(markdown: string, options: ConvertOptions): Promise<ConvertResult> {
    if (markdown.length > MAX_MARKDOWN_CHARS) throw Object.assign(new Error("This Markdown is larger than 10 MB."), { __kind: "too_large" });
    const pause = yielder();
    const document = parseMarkdown(markdown);
    const equations = collectMath(document);
    options.onStart?.(equations.length);
    await pause();
    const math = new Map<object, MathResult>();
    if (equations.length) {
        const temml = await (options.loadTemml ?? loadTemml)();
        for (let index = 0; index < equations.length; index++) {
            const node = equations[index];
            math.set(node, latexToOmml(temml, node.tex, node.type === "math" && "display" in node ? node.display : true));
            options.onProgress?.((index + 1) / (equations.length + 1));
            await pause();
        }
    }
    const title = (options.title ?? firstHeading(document)).trim();
    const { files, report } = new DocxWriter({ page: options.page, title, made: options.made, math }).write(document);
    await pause();
    const zippable: Zippable = {};
    for (const [path, bytes] of Object.entries(files)) {
        // Images are compressed already; the XML parts are text, which compresses well.
        zippable[path] = path.startsWith("word/media/") ? [bytes, { level: 0 }] : [bytes, { level: 6 }];
    }
    const zipped = zipSync(zippable);
    options.onProgress?.(1);
    return { blob: new Blob([zipped], { type: DOCX_TYPE }), title, report };
}
