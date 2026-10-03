/**
 * The text of a chosen file, read in this browser and never uploaded: text
 * and code decoded here, PDFs read with pdf.js (the copy the PDF tools use),
 * Word files unzipped with fflate (already a dependency) and their body read
 * from word/document.xml. What is read is what gets counted, so every rule
 * about what is left out is stated where it is applied.
 */
import { unzipSync } from "fflate";
import { withErrorKind } from "@/lib/api";
import type { ToolErrorKind } from "@/lib/toolRun";
import { throwIfAborted } from "./gpt";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_LABEL = "100 MB";
/** About 4 to 5 million GPT tokens of English: more than any current model takes at once. */
export const MAX_TEXT_CHARS = 20_000_000;
/** word/document.xml unpacked: markup runs several times the text it carries. */
const MAX_DOCX_XML_BYTES = 64 * 1024 * 1024;

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

export type ReadFailure =
    | "too-large" | "empty" | "binary" | "text-too-long"
    | "pdf-unreadable" | "pdf-password" | "pdf-no-text"
    | "docx-unreadable" | "docx-too-large";

/** A file the page could not read, with words for the visitor and the reason as a code. */
export class ReadError extends Error {
    readonly code: ReadFailure;
    constructor(code: ReadFailure, message: string, kind: ToolErrorKind = "bad_input") {
        super(message);
        this.name = "ReadError";
        this.code = code;
        withErrorKind(this, kind);
    }
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

// ── Word ──────────────────────────────────────────────────────────────────

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

class XmlTooLarge extends Error {}

/**
 * The text of a Word document's body, as Word shows it with tracked changes
 * accepted: paragraphs on lines of their own, tables cell by cell, tabs and
 * line breaks kept, text boxes once. Left out: headers, footers, footnotes,
 * endnotes and comments (other parts of the file), deleted and moved-away
 * text, field codes, and formatting.
 */
export async function readDocxText(bytes: Uint8Array, { name = "This file" }: { name?: string } = {}): Promise<string> {
    const unreadable = () => new ReadError("docx-unreadable", `${name} couldn’t be read as a Word document. It may be damaged, or an older .doc file renamed: save it as .docx and try again.`);
    let xml: Uint8Array | undefined;
    try {
        xml = unzipSync(bytes, {
            filter: entry => {
                if (entry.name !== "word/document.xml") return false;
                if (entry.originalSize > MAX_DOCX_XML_BYTES) throw new XmlTooLarge();
                return true;
            },
        })["word/document.xml"];
    } catch (error) {
        if (error instanceof XmlTooLarge) {
            throw new ReadError("docx-too-large", `${name} holds more document text than this page reads at once. Split it into smaller documents and count each one.`, "too_large");
        }
        throw unreadable();
    }
    if (!xml) throw unreadable();
    const doc = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(xml), "application/xml");
    if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) throw unreadable();
    const out: string[] = [];
    readWordElement(doc.documentElement, out);
    return out.join("").replace(/\n$/, "");
}

function readWordElement(parent: Element, out: string[]): void {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
        const name = child.localName;
        if (child.namespaceURI === MC_NS) {
            // Content saved twice for older readers (a text box as a shape and
            // as VML): read the first alternative only.
            if (name === "AlternateContent") {
                const choice = [...child.children].find(alt => alt.namespaceURI === MC_NS && (alt.localName === "Choice" || alt.localName === "Fallback"));
                if (choice) readWordElement(choice, out);
            }
            continue;
        }
        if (child.namespaceURI !== W_NS) { readWordElement(child, out); continue; }
        // Properties (pPr, rPr, sectPr, tblPr…) hold no text; their w:tab elements are tab stops, not tabs.
        if (name.endsWith("Pr")) continue;
        switch (name) {
            case "t": out.push(child.textContent ?? ""); break;
            case "tab": out.push("\t"); break;
            case "br": case "cr": out.push("\n"); break;
            case "noBreakHyphen": out.push("-"); break;
            case "delText": case "instrText": case "moveFrom": break;
            case "p": readWordElement(child, out); out.push("\n"); break;
            default: readWordElement(child, out);
        }
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
 */
export async function readPdfText(data: Uint8Array, { name = "This PDF", signal, onProgress, pdfjs = loadPdfjs }: PdfReadOptions = {}): Promise<{ text: string; pages: number }> {
    const lib = await pdfjs();
    throwIfAborted(signal);
    const task = lib.getDocument({ data, isEvalSupported: false, verbosity: 0 });
    let doc: PdfDocumentLike;
    try {
        doc = await task.promise;
    } catch (error) {
        if ((error as Error)?.name === "PasswordException") {
            throw new ReadError("pdf-password", `${name} needs a password to open, so its text can’t be read. If you know the password, Unlock PDF can remove it first; that tool uploads the PDF to PrivaTools for temporary processing.`);
        }
        throw new ReadError("pdf-unreadable", `${name} couldn’t be read as a PDF. It may be damaged or not a PDF at all.`);
    }
    try {
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
            throw new ReadError("pdf-no-text", `${name} has no text to count: ${pages}, such as a scan. OCR PDF can add a text layer first.`);
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
}

export async function readFileText(file: File, { signal, onProgress, pdfjs }: FileReadOptions = {}): Promise<FileText> {
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
        result = { text: await readDocxText(bytes, { name }), kind: "docx" };
    } else {
        const decoded = decodeText(bytes);
        if (!decoded) throw new ReadError("binary", `${name} doesn’t look like a text file: it holds binary data. Choose a text, PDF or Word file, or paste the text instead.`);
        result = { text: decoded.text, kind: "text", encoding: decoded.encoding };
    }
    checkTextLength(result.text);
    return result;
}
