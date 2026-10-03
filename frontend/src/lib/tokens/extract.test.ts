/**
 * Reading text from a chosen file, in the browser. Every fixture is made here:
 * text in several encodings, Word files zipped with fflate, PDFs written by
 * hand and opened by pdf.js's own legacy build.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { toolErrorKind } from "@/lib/toolRun";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";
import { ACCEPTS, MAX_FILE_BYTES, MAX_TEXT_CHARS, checkTextLength, decodeText, readDocxText, readFileText, readPdfText, type PdfjsLike } from "./extract";

const legacyPdfjs = async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;

/** A PDF whose pages carry these lines of Helvetica text, one Tj per line. */
function textPdf(pages: string[][]): Uint8Array {
    const escape = (s: string) => s.replace(/[\\()]/g, c => `\\${c}`);
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ];
    pages.forEach((lines, i) => {
        const ops = lines.map((line, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${escape(line)}) Tj ET`).join("\n");
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
        objects.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    });
    let out = "%PDF-1.7\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"';

function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
    return zipSync({
        "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
        "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
        ...extra,
    });
}

const file = (bytes: Uint8Array | string, name: string, type = "") => new File([bytes as BlobPart], name, { type });

async function failure(run: Promise<unknown>): Promise<Error> {
    try { await run; } catch (e) { return e as Error; }
    throw new Error("expected a failure");
}

describe("text and code files", () => {
    it("reads UTF-8, without its byte-order mark", () => {
        expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("café 数据 🙂\n")]))).toEqual({ text: "café 数据 🙂\n", encoding: "UTF-8" });
    });

    it("reads UTF-16 marked by its byte-order mark, either way round", () => {
        const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00, 0x3d, 0xd8, 0x42, 0xde]);
        expect(decodeText(le)).toEqual({ text: "hi🙂", encoding: "UTF-16" });
        const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
        expect(decodeText(be)).toEqual({ text: "hi", encoding: "UTF-16" });
    });

    it("falls back to Windows-1252 for text that isn't UTF-8, and says so", () => {
        expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]))).toEqual({ text: "café €", encoding: "Windows-1252" });
    });

    it("refuses a binary file named like text", async () => {
        const error = await failure(readFileText(file(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]), "notes.txt")));
        expect(error.message).toBe("notes.txt doesn’t look like a text file: it holds binary data. Choose a text, PDF or Word file, or paste the text instead.");
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("reads a code file as it is", async () => {
        const source = "export const answer = 42;\n\tconsole.log(answer);\n";
        expect(await readFileText(file(source, "answer.ts"))).toEqual({ text: source, kind: "text", encoding: "UTF-8" });
    });

    it("refuses an empty file and one over the size limit", async () => {
        const empty = await failure(readFileText(file("", "empty.md")));
        expect(empty.message).toBe("empty.md is empty.");
        expect(toolErrorKind(empty)).toBe("bad_input");
        const big = file("x", "huge.txt");
        Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
        const tooBig = await failure(readFileText(big));
        expect(tooBig.message).toMatch(/^huge\.txt is larger than 100 MB, more than this page reads at once\./);
        expect(toolErrorKind(tooBig)).toBe("too_large");
    });

    it("refuses text longer than the page counts at once", () => {
        expect(() => checkTextLength("x".repeat(MAX_TEXT_CHARS))).not.toThrow();
        const error = (() => { try { checkTextLength("x".repeat(MAX_TEXT_CHARS + 1)); } catch (e) { return e as Error; } throw new Error("no error"); })();
        expect(error.message).toMatch(/more than 20 million characters/);
        expect(toolErrorKind(error)).toBe("too_large");
    });

    it("accepts the types the page names, and no others", () => {
        const types = ACCEPTS.split(",");
        for (const ext of [".txt", ".md", ".csv", ".json", ".jsonl", ".xml", ".html", ".py", ".ts", ".js", ".pdf", ".docx", ".srt"]) expect(types).toContain(ext);
        for (const ext of [".doc", ".png", ".zip", ".xlsx"]) expect(types).not.toContain(ext);
    });

    it("takes exactly what the registry says the tool takes", () => {
        // The registry must hold literals (gen-llms reads it without running it), so the list is written twice.
        expect(nonPdfToolBySlug["ai-token-counter"].accepts).toBe(ACCEPTS);
    });
});

describe("Word files", () => {
    it("reads the body's paragraphs, tabs, breaks and tables, and nothing deleted or hidden in a field code", async () => {
        const body = [
            '<w:p><w:r><w:t>First </w:t></w:r><w:r><w:t xml:space="preserve">paragraph &amp; more</w:t></w:r></w:p>',
            "<w:p><w:r><w:t>Tab</w:t><w:tab/><w:t>stop</w:t><w:br/><w:t>new line</w:t></w:r></w:p>",
            '<w:p><w:del w:id="1"><w:r><w:delText>deleted words</w:delText></w:r></w:del><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>kept</w:t></w:r></w:p>',
            "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
            '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>text box</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>text box</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>',
            "<w:p/>",
            "<w:p><w:r><w:t>Last line</w:t></w:r></w:p>",
            '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
        ].join("");
        expect(await readDocxText(docx(body))).toBe("First paragraph & more\nTab\tstop\nnew line\nkept\ncell one\ncell two\ntext box\n\n\nLast line");
    });

    it("reads a Word file through the same entry point as other files", async () => {
        const read = await readFileText(file(docx("<w:p><w:r><w:t>Hello Word</w:t></w:r></w:p>"), "letter.docx"));
        expect(read).toEqual({ text: "Hello Word", kind: "docx" });
    });

    it("says when a .docx is not a Word document", async () => {
        for (const bytes of [strToU8("plain text, not a zip"), zipSync({ "hello.txt": strToU8("hi") })]) {
            const error = await failure(readFileText(file(bytes, "report.docx")));
            expect(error.message).toBe("report.docx couldn’t be read as a Word document. It may be damaged, or an older .doc file renamed: save it as .docx and try again.");
            expect(toolErrorKind(error)).toBe("bad_input");
        }
    });

    it("refuses a Word file whose text would unpack beyond what the page reads", async () => {
        const huge = new Uint8Array(70 * 1024 * 1024).fill(0x20);
        const bytes = zipSync({ "word/document.xml": huge }, { level: 9 });
        const error = await failure(readFileText(file(bytes, "bomb.docx")));
        expect(error.message).toMatch(/^bomb\.docx holds more document text than this page reads at once/);
        expect(toolErrorKind(error)).toBe("too_large");
    });
});

describe("PDFs", () => {
    it("reads each page's lines, pages apart", async () => {
        const read = await readPdfText(textPdf([["Page one, line one.", "Page one, line two."], ["Page two (with brackets)."]]), { pdfjs: legacyPdfjs });
        expect(read).toEqual({ text: "Page one, line one.\nPage one, line two.\n\nPage two (with brackets).", pages: 2 });
    });

    it("reports progress page by page", async () => {
        const seen: number[] = [];
        await readPdfText(textPdf([["a"], ["b"], ["c"]]), { pdfjs: legacyPdfjs, onProgress: (done, total) => { seen.push(done); expect(total).toBe(3); } });
        expect(seen).toEqual([1, 2, 3]);
    });

    it("says when a PDF has no text to count", async () => {
        const error = await failure(readPdfText(textPdf([[], []]), { pdfjs: legacyPdfjs }));
        expect(error.message).toBe("This PDF has no text to count: its 2 pages are probably images, such as a scan. OCR PDF can add a text layer first.");
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("says when a file is not a readable PDF", async () => {
        const error = await failure(readFileText(file("%PDF-1.7 not really", "broken.pdf"), { pdfjs: legacyPdfjs }));
        expect(error.message).toBe("broken.pdf couldn’t be read as a PDF. It may be damaged or not a PDF at all.");
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("says when a PDF needs a password, and where to remove it", async () => {
        const locked: PdfjsLike = {
            GlobalWorkerOptions: {},
            getDocument: () => ({ promise: Promise.reject(Object.assign(new Error("No password given"), { name: "PasswordException" })), destroy: async () => {} }),
        } as unknown as PdfjsLike;
        const error = await failure(readFileText(file("%PDF-1.7", "locked.pdf"), { pdfjs: async () => locked }));
        expect(error.message).toBe("locked.pdf needs a password to open, so its text can’t be read. If you know the password, Unlock PDF can remove it first; that tool uploads the PDF to PrivaTools for temporary processing.");
        expect(toolErrorKind(error)).toBe("bad_input");
    });
});
