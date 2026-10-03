/**
 * Reading text from a chosen file, in the browser. Every fixture is made here:
 * text in several encodings, Word files zipped with fflate, PDFs written by
 * hand and opened by pdf.js's own legacy build.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { toolErrorKind } from "@/lib/toolRun";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";
import { ACCEPTS, MAX_FILE_BYTES, MAX_TEXT_CHARS, checkTextLength, decodeText, readFileText, readPdfText, type PdfjsLike } from "./extract";
import { MAX_DOCX_XML_BYTES, readDocxText, wordBodyText } from "./docx";

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

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** The reader this page had before the worker: DOMParser and a walk. The scan must read every document as it did. */
function domReading(xml: string): string | null {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) return null;
    const out: string[] = [];
    const walk = (parent: Element) => {
        for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
            const name = child.localName;
            if (child.namespaceURI === MC_NS) {
                if (name === "AlternateContent") {
                    const choice = [...child.children].find(alt => alt.namespaceURI === MC_NS && (alt.localName === "Choice" || alt.localName === "Fallback"));
                    if (choice) walk(choice);
                }
                continue;
            }
            if (child.namespaceURI !== W_NS) { walk(child); continue; }
            if (name.endsWith("Pr")) continue;
            switch (name) {
                case "t": out.push(child.textContent ?? ""); break;
                case "tab": out.push("\t"); break;
                case "br": case "cr": out.push("\n"); break;
                case "noBreakHyphen": out.push("-"); break;
                case "delText": case "instrText": case "moveFrom": break;
                case "p": walk(child); out.push("\n"); break;
                default: walk(child);
            }
        }
    };
    walk(doc.documentElement);
    return out.join("").replace(/\n$/, "");
}

const documentXml = (body: string, namespaces = W) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${namespaces}><w:body>${body}</w:body></w:document>`;

describe("Word files", () => {
    it("reads the body's paragraphs, tabs, breaks and tables, and nothing deleted or hidden in a field code", () => {
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
        expect(readDocxText(docx(body))).toBe("First paragraph & more\nTab\tstop\nnew line\nkept\ncell one\ncell two\ntext box\n\n\nLast line");
    });

    it("reads markup as XML does: entities, CDATA, line ends, quoted '>', comments and instructions", () => {
        const body = [
            '<w:p w:rsidR="00A>11"><w:r><w:t xml:space=\'preserve\'>a > b &lt;c&gt; &amp; &quot;d&quot; &apos;e&apos; &#65;&#x42;&#x1F642;</w:t></w:r></w:p>',
            "<w:p><w:r><w:t><![CDATA[x < y & z]]></w:t></w:r></w:p>",
            "<w:p><w:r><w:t>one\r\ntwo\rthree</w:t></w:r></w:p>",
            "<!-- <w:p><w:r><w:t>a comment</w:t></w:r></w:p> --><?mso-application progid=\"Word.Document\"?>",
            "<w:p><w:r><w:t>end</w:t></w:r></w:p>",
        ].join("");
        expect(wordBodyText(documentXml(body))).toBe("a > b <c> & \"d\" 'e' AB🙂\nx < y & z\none\ntwo\nthree\nend");
    });

    it("goes by namespace, not by prefix", () => {
        const prefixed = `<x:document xmlns:x="${W_NS}"><x:body><x:p><x:r><x:t>prefixed</x:t></x:r></x:p><x:p><x:r><x:t>twice</x:t></x:r></x:p></x:body></x:document>`;
        expect(wordBodyText(prefixed)).toBe("prefixed\ntwice");
        expect(wordBodyText(`<document xmlns="${W_NS}"><body><p><r><t>default namespace</t></r></p></body></document>`)).toBe("default namespace");
        // A "t" from another vocabulary holds no Word text, and an inner declaration can rebind a prefix.
        const other = documentXml(`<w:p><o:t xmlns:o="urn:example:other">hidden</o:t><w:r><w:t>shown</w:t></w:r><w:r xmlns:w="urn:example:not-word"><w:t>not Word</w:t></w:r></w:p>`);
        expect(wordBodyText(other)).toBe("shown");
    });

    it("reads moved text once, a non-breaking hyphen as a hyphen, and no tab stops", () => {
        const body = [
            '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>left</w:t></w:r></w:p>',
            "<w:p><w:moveFrom><w:r><w:t>moved away</w:t></w:r></w:moveFrom><w:moveTo><w:r><w:t>moved here</w:t></w:r></w:moveTo></w:p>",
            "<w:p><w:r><w:t>well</w:t><w:noBreakHyphen/><w:t>known</w:t><w:cr/><w:t>next</w:t></w:r></w:p>",
        ].join("");
        expect(wordBodyText(documentXml(body))).toBe("left\nmoved here\nwell-known\nnext");
    });

    it("refuses markup that isn't well formed", () => {
        for (const body of [
            "<w:p><w:r><w:t>unclosed</w:t></w:r>",
            "<w:p><w:r><w:t>crossed</w:p></w:r></w:t>",
            "<w:p><w:r><w:t>stray < sign</w:t></w:r></w:p>",
            "<w:p><w:r><w:t unquoted=value>bad attribute</w:t></w:r></w:p>",
        ]) {
            expect(wordBodyText(documentXml(body)), body).toBeNull();
            expect(domReading(documentXml(body)), body).toBeNull();
        }
    });

    it("reads every generated document exactly as DOMParser did", () => {
        const pieces = [
            "<w:r><w:t>word</w:t></w:r>", '<w:r><w:t xml:space="preserve"> spaced &amp; </w:t></w:r>', "<w:r><w:tab/></w:r>", "<w:r><w:br/></w:r>",
            "<w:r><w:cr/></w:r>", "<w:r><w:noBreakHyphen/></w:r>", "<w:r><w:rPr><w:b/><w:tab/></w:rPr><w:t>bold</w:t></w:r>",
            "<w:del><w:r><w:delText>gone</w:delText></w:r></w:del>", "<w:ins><w:r><w:t>added</w:t></w:r></w:ins>",
            "<w:r><w:instrText>PAGE</w:instrText></w:r>", "<w:moveFrom><w:r><w:t>from</w:t></w:r></w:moveFrom>",
            "<w:r><w:t><![CDATA[a<b]]></w:t></w:r>", "<!-- note -->", "<w:r><w:t>数据 🙂</w:t></w:r>",
            '<mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t>first</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>second</w:t></w:r></mc:Fallback></mc:AlternateContent>',
            "<mc:Ignorable/>", "<wps:wsp><w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p></w:txbxContent></wps:wsp>",
        ];
        let seed = 99;
        const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 8; };
        for (let round = 0; round < 300; round++) {
            const paragraphs = Array.from({ length: 1 + (random() % 6) }, () => {
                const runs = Array.from({ length: random() % 6 }, () => pieces[random() % pieces.length]).join("");
                return random() % 5 ? `<w:p>${runs}</w:p>` : `<w:tbl><w:tr><w:tc><w:p>${runs}</w:p></w:tc></w:tr></w:tbl>`;
            });
            const xml = documentXml(paragraphs.join(""));
            expect(wordBodyText(xml), xml).toBe(domReading(xml));
        }
    });

    it("reads a Word file through the same entry point as other files", async () => {
        const read = await readFileText(file(docx("<w:p><w:r><w:t>Hello Word</w:t></w:r></w:p>"), "letter.docx"));
        expect(read).toEqual({ text: "Hello Word", kind: "docx" });
    });

    it("hands a Word file to the reader it is given: the page's is the token worker", async () => {
        const seen: Array<[number, string]> = [];
        const read = await readFileText(file(docx("<w:p/>"), "letter.docx"), { readDocx: async (bytes, name) => { seen.push([bytes.length, name]); return "from the worker"; } });
        expect(read).toEqual({ text: "from the worker", kind: "docx" });
        expect(seen).toEqual([[docx("<w:p/>").length, "letter.docx"]]);
    });

    it("says when a .docx is not a Word document", async () => {
        for (const bytes of [strToU8("plain text, not a zip"), zipSync({ "hello.txt": strToU8("hi") }), docx("<w:p><w:r><w:t>unclosed</w:r></w:p>")]) {
            const error = await failure(readFileText(file(bytes, "report.docx")));
            expect(error.message).toBe("report.docx couldn’t be read as a Word document. It may be damaged, or an older .doc file renamed: save it as .docx and try again.");
            expect(toolErrorKind(error)).toBe("bad_input");
        }
    });

    it("refuses a Word file whose document part unpacks to more than 32 MB, markup included", async () => {
        const huge = new Uint8Array(MAX_DOCX_XML_BYTES + 1).fill(0x20);
        const bytes = zipSync({ "word/document.xml": huge }, { level: 1 });
        const error = await failure(readFileText(file(bytes, "bomb.docx")));
        expect(error.message).toBe("bomb.docx is too large to read here: its main document part, markup included, unpacks to more than 32 MB. Split it into smaller documents and count each one.");
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

    it("says when a PDF has no text to count, leaving the tool that helps to the page", async () => {
        const error = await failure(readPdfText(textPdf([[], []]), { pdfjs: legacyPdfjs }));
        expect(error.message).toBe("This PDF has no text to count: its 2 pages are probably images, such as a scan.");
        expect(error).toMatchObject({ code: "pdf-no-text" });
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("says a PDF with no pages has none, rather than calling it a scan", async () => {
        const error = await failure(readFileText(file(textPdf([]), "nopages.pdf"), { pdfjs: legacyPdfjs }));
        expect(error.message).toBe("nopages.pdf has no pages.");
        expect(error).toMatchObject({ code: "empty" });
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("says when a file is not a readable PDF", async () => {
        const error = await failure(readFileText(file("%PDF-1.7 not really", "broken.pdf"), { pdfjs: legacyPdfjs }));
        expect(error.message).toBe("broken.pdf couldn’t be read as a PDF. It may be damaged or not a PDF at all.");
        expect(toolErrorKind(error)).toBe("bad_input");
    });

    it("says when a PDF needs a password, leaving the tool that removes one to the page", async () => {
        const locked: PdfjsLike = {
            GlobalWorkerOptions: {},
            getDocument: () => ({ promise: Promise.reject(Object.assign(new Error("No password given"), { name: "PasswordException" })), destroy: async () => {} }),
        } as unknown as PdfjsLike;
        const error = await failure(readFileText(file("%PDF-1.7", "locked.pdf"), { pdfjs: async () => locked }));
        expect(error.message).toBe("locked.pdf needs a password to open, so its text can’t be read.");
        expect(error).toMatchObject({ code: "pdf-password" });
        expect(toolErrorKind(error)).toBe("bad_input");
    });
});
