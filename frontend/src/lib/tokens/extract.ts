/**
 * The text of a chosen file, read in this browser and never uploaded: text
 * and code decoded here, PDFs read with pdf.js (the copy the PDF tools use),
 * Word files unzipped with fflate (already a dependency) and their body read
 * from word/document.xml (docx.ts, run in the token worker by the page).
 * What is read is what gets counted, so every rule about what is left out is
 * stated where it is applied.
 */
import { readDocxText } from "./docx";
import { ReadError } from "./errors";
import { throwIfAborted } from "./gpt";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_LABEL = "100 MB";
/** About 4 to 5 million GPT tokens of English: more than any current model takes at once. */
export const MAX_TEXT_CHARS = 20_000_000;

/** Text and code types the picker offers; any other file the browser calls text/* is read the same way. */
const TEXT_TYPES = [
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm", ".yaml", ".yml", ".toml",
    ".log", ".srt", ".vtt", ".tex", ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs", ".rb", ".php",
    ".c", ".h", ".cpp", ".cs", ".swift", ".kt", ".sql", ".sh", ".css",
];
/** The registry entry’s `accepts` repeats this list; extract.test.ts holds the two together. */
export const ACCEPTS = [...TEXT_TYPES, ".pdf", ".docx", "text/*"].join(",");

export type SourceKind = "text" | "pdf" | "docx";
export type TextEncodingName = "UTF-8" | "UTF-16" | "Windows-1252";

export interface FileText {
    text: string;
    kind: SourceKind;
    /** How a text file was decoded. */
    encoding?: TextEncodingName;
    /** A PDF's page count. */
    pages?: number;
}

const extension = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** Too much text to count at once on a phone or a laptop alike. */
export function checkTextLength(text: string): void {
    if (text.length > MAX_TEXT_CHARS) {
        throw new ReadError("text-too-long", "This text is more than 20 million characters, more than this page counts at once. Split it into parts and count each one.", "too_large");
    }
}

/**
 * Decode a text file: by its byte-order mark when it has one, else as UTF-8,
 * else as Windows-1252, the usual encoding of older Western files. Null when
 * the bytes hold NUL characters, which no text file does.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } | null {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8" };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16" };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16" };
    if (bytes.subarray(0, 65536).includes(0)) return null;
    try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
    } catch {
        return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
    }
}

// ── PDF ───────────────────────────────────────────────────────────────────

interface PdfTextItem { str?: string; hasEOL?: boolean }
interface PdfPageLike { getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup(): void }
interface PdfDocumentLike { numPages: number; getPage(number: number): Promise<PdfPageLike>; destroy(): Promise<void> }

/** The part of pdf.js this page uses. */
export interface PdfjsLike {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(source: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number }): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };
}

let pdfjsLoading: Promise<PdfjsLike> | null = null;

/** pdf.js with its worker, loaded the way the other PDF tools load it, on first use. */
export function loadPdfjs(): Promise<PdfjsLike> {
    pdfjsLoading ??= (async () => {
        const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        return lib as unknown as PdfjsLike;
    })();
    pdfjsLoading.catch(() => { pdfjsLoading = null; });
    return pdfjsLoading;
}

export interface PdfReadOptions {
    name?: string;
    signal?: AbortSignal;
    onProgress?: (page: number, pages: number) => void;
    /** Which pdf.js to use: tests pass its legacy build. */
    pdfjs?: () => Promise<PdfjsLike>;
}

/**
 * Each page's text in reading order as pdf.js extracts it, a line end where
 * pdf.js marks one, pages a blank line apart. Pages without text add nothing.
 * The tools that help with a locked or scanned PDF are named by the page,
 * beside the reason, with links.
 */
export async function readPdfText(data: Uint8Array, { name = "This PDF", signal, onProgress, pdfjs = loadPdfjs }: PdfReadOptions = {}): Promise<{ text: string; pages: number }> {
    const lib = await pdfjs();
    throwIfAborted(signal);
    const task = lib.getDocument({ data, isEvalSupported: false, verbosity: 0 });
    let doc: PdfDocumentLike;
    try {
        doc = await task.promise;
    } catch (error) {
        if ((error as Error)?.name === "PasswordException") throw new ReadError("pdf-password", `${name} needs a password to open, so its text can’t be read.`);
        throw new ReadError("pdf-unreadable", `${name} couldn’t be read as a PDF. It may be damaged or not a PDF at all.`);
    }
    try {
        if (doc.numPages === 0) throw new ReadError("empty", `${name} has no pages.`);
        const texts: string[] = [];
        for (let number = 1; number <= doc.numPages; number++) {
            throwIfAborted(signal);
            const page = await doc.getPage(number);
            const { items } = await page.getTextContent();
            let text = "";
            for (const item of items) {
                if (typeof item.str !== "string") continue;
                text += item.str;
                if (item.hasEOL) text += "\n";
            }
            page.cleanup();
            text = text.replace(/[ \t]+\n/g, "\n").trim();
            if (text) texts.push(text);
            onProgress?.(number, doc.numPages);
        }
        if (!texts.length) {
            const pages = doc.numPages === 1 ? "its only page is probably an image" : `its ${doc.numPages.toLocaleString("en-US")} pages are probably images`;
            throw new ReadError("pdf-no-text", `${name} has no text to count: ${pages}, such as a scan.`);
        }
        return { text: texts.join("\n\n"), pages: doc.numPages };
    } finally {
        void doc.destroy();
    }
}

// ── Any accepted file ─────────────────────────────────────────────────────

export interface FileReadOptions {
    signal?: AbortSignal;
    onProgress?: (page: number, pages: number) => void;
    pdfjs?: () => Promise<PdfjsLike>;
    /** What reads a Word file's body: the page passes the token worker's reader; by default, docx.ts here. */
    readDocx?: (bytes: Uint8Array, name: string) => string | Promise<string>;
}

export async function readFileText(file: File, { signal, onProgress, pdfjs, readDocx = (bytes, name) => readDocxText(bytes, { name }) }: FileReadOptions = {}): Promise<FileText> {
    const name = file.name || "This file";
    if (file.size > MAX_FILE_BYTES) {
        throw new ReadError("too-large", `${name} is larger than ${MAX_FILE_LABEL}, more than this page reads at once. Split it, or paste the part you need.`, "too_large");
    }
    if (file.size === 0) throw new ReadError("empty", `${name} is empty.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
    const ext = extension(name);
    let result: FileText;
    if (ext === ".pdf" || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        const pdf = await readPdfText(bytes, { name, signal, onProgress, pdfjs });
        result = { text: pdf.text, kind: "pdf", pages: pdf.pages };
    } else if (ext === ".docx") {
        result = { text: await readDocx(bytes, name), kind: "docx" };
    } else {
        const decoded = decodeText(bytes);
        if (!decoded) throw new ReadError("binary", `${name} doesn’t look like a text file: it holds binary data. Choose a text, PDF or Word file, or paste the text instead.`);
        result = { text: decoded.text, kind: "text", encoding: decoded.encoding };
    }
    checkTextLength(result.text);
    return result;
}
