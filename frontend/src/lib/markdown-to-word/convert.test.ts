import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import temml from "temml";
import { collectMath, convertMarkdownToDocx, docxFileName, DOCX_TYPE, MAX_MARKDOWN_CHARS, type ConversionReport } from "./convert";
import { columnWidths } from "./docx";
import { parseMarkdown } from "./markdown";
import { imageName, imageSize, readImageSource } from "./images";

// A synthetic 1×1 PNG, a 3×2 GIF and the start of a 640×480 JPEG: enough for the headers the converter reads.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const GIF = btoa(String.fromCharCode(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 2, 0, 0, 0, 0, 0x3b));
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9));

/** Every construct the tool promises, as an AI answer might write them. */
const SAMPLE = [
    "# Quarterly report",
    "",
    "Intro with **bold**, *italic*, ~~struck~~, `inline code`, a [link](https://example.com/a?b=1&c=2) and a [jump](#results).",
    "",
    "## Results",
    "### Third",
    "#### Fourth",
    "##### Fifth",
    "###### Sixth",
    "",
    "- bullet one",
    "  - nested bullet",
    "- bullet two",
    "",
    "3. three",
    "4. four",
    "",
    "- [x] done task",
    "- [ ] open task",
    "",
    "> A quote with $x^2$ inside.",
    "",
    "```python",
    "def f(x):",
    "    return x * 2",
    "```",
    "",
    "| Item | Qty | Price |",
    "|:-----|:---:|------:|",
    "| Pen  | 2   | $3    |",
    "| Ink  | 10  | $1    |",
    "",
    "---",
    "",
    "Inline $E = mc^2$ and \\(a_1 + b_1\\).",
    "",
    "$$",
    "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    "$$",
    "",
    "\\[ \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix} \\]",
    "",
    "Unsupported: $\\unknownthing{x}$.",
    "",
    `![A pixel](data:image/png;base64,${PNG}) ![A chart](https://example.com/chart.png)`,
].join("\n");

const decoder = new TextDecoder();
const MADE = new Date("2026-10-03T08:00:00Z");

async function convert(markdown: string, page: "letter" | "a4" = "letter") {
    const result = await convertMarkdownToDocx(markdown, { page, loadTemml: async () => temml, made: MADE });
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const text = (path: string) => decoder.decode(files[path]);
    const xml = (path: string) => {
        const doc = new DOMParser().parseFromString(text(path), "application/xml");
        expect(doc.getElementsByTagName("parsererror"), path).toHaveLength(0);
        return doc;
    };
    return { result, files, text, xml };
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const byTag = (doc: Document, ns: string, name: string) => [...doc.getElementsByTagNameNS(ns, name)];
const attr = (element: Element | undefined, name: string) => element?.getAttributeNS(W, name) ?? element?.getAttribute(`w:${name}`) ?? null;
const childNames = (element: Element) => [...element.children].map(child => child.localName);
const styleOf = (p: Element) => attr(p.getElementsByTagNameNS(W, "pStyle")[0], "val");

// The element order ECMA-376 Part 1 requires, for the property elements this converter writes.
const ORDER: Record<string, string[]> = {
    pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
    rPr: ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
    tblPr: ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook"],
    tcPr: ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
    sectPr: ["headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders", "lnNumType", "pgNumType", "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid", "printerSettings"],
    style: ["name", "aliases", "basedOn", "next", "link", "autoRedefine", "hidden", "uiPriority", "semiHidden", "unhideWhenUsed", "qFormat", "locked", "personal", "personalCompose", "personalReply", "rsid", "pPr", "rPr", "tblPr", "trPr", "tcPr", "tblStylePr"],
    lvl: ["start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlPicBulletId", "legacy", "lvlJc", "pPr", "rPr"],
    naryPr: ["chr", "limLoc", "grow", "subHide", "supHide", "ctrlPr"],
    dPr: ["begChr", "sepChr", "endChr", "grow", "shp", "ctrlPr"],
    mPr: ["baseJc", "plcHide", "rSpRule", "cGpRule", "rSp", "cSp", "cGp", "mcs", "ctrlPr"],
    r: ["rPr", "t"],
};

function expectSchemaOrder(doc: Document) {
    for (const [name, order] of Object.entries(ORDER)) {
        const ns = ["naryPr", "dPr", "mPr"].includes(name) ? M : W;
        for (const element of byTag(doc, ns, name)) {
            const names = childNames(element).filter(child => order.includes(child));
            const positions = names.map(child => order.indexOf(child));
            expect(positions, `${name}: ${names.join(", ")}`).toEqual([...positions].sort((a, b) => a - b));
        }
    }
}

let fetchSpy: ReturnType<typeof vi.fn>;
let xhrOpen: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
    vi.stubGlobal("fetch", fetchSpy);
    xhrOpen = vi.spyOn(XMLHttpRequest.prototype, "open");
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Markdown to Word: the document", () => {
    it("is a Word package whose parts are all well-formed and declared", async () => {
        const { result, files, text, xml } = await convert(SAMPLE);
        expect(result.blob.type).toBe(DOCX_TYPE);
        expect(Object.keys(files).sort()).toEqual([
            "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/fontTable.xml",
            "word/media/image1.png", "word/numbering.xml", "word/settings.xml", "word/styles.xml", "word/theme/theme1.xml",
        ]);
        for (const path of Object.keys(files).filter(path => !path.startsWith("word/media/"))) xml(path);
        const types = text("[Content_Types].xml");
        for (const part of ["/word/document.xml", "/word/styles.xml", "/word/numbering.xml", "/word/settings.xml", "/word/fontTable.xml", "/word/theme/theme1.xml", "/docProps/core.xml"]) {
            expect(types).toContain(`PartName="${part}"`);
        }
        expect(types).toContain("<Default Extension=\"png\" ContentType=\"image/png\"/>");
        expect(text("docProps/core.xml")).toContain("<dc:title>Quarterly report</dc:title>");
        expect(text("docProps/core.xml")).toContain("2026-10-03T08:00:00Z");
        expect(text("docProps/core.xml")).not.toMatch(/creator|lastModifiedBy/);
        // Word 2013+ mode, so Word opens it without the compatibility banner, and its math settings.
        expect(text("word/settings.xml")).toContain("w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"");
        expect(text("word/settings.xml")).toContain("<m:mathFont m:val=\"Cambria Math\"/>");
        // Every relationship the document uses exists, and every part a relationship names is in the package.
        const rels = xml("word/_rels/document.xml.rels");
        const ids = new Set([...rels.getElementsByTagName("Relationship")].map(rel => rel.getAttribute("Id")));
        for (const match of text("word/document.xml").matchAll(/r:(?:id|embed)="([^"]+)"/g)) expect(ids.has(match[1]), match[1]).toBe(true);
        for (const rel of [...rels.getElementsByTagName("Relationship")].filter(rel => rel.getAttribute("TargetMode") !== "External")) {
            expect(files[`word/${rel.getAttribute("Target")}`], rel.getAttribute("Target")!).toBeDefined();
        }
    });

    it("writes every property element in the order Word requires", async () => {
        const { xml } = await convert(SAMPLE);
        for (const part of ["word/document.xml", "word/styles.xml", "word/numbering.xml"]) expectSchemaOrder(xml(part));
    });

    it("uses Word's built-in styles, defined in the document", async () => {
        const { xml, text } = await convert(SAMPLE);
        const styles = xml("word/styles.xml");
        const defined = new Map(byTag(styles, W, "style").map(style => [attr(style, "styleId"), attr(style.getElementsByTagNameNS(W, "name")[0], "val")]));
        expect(Object.fromEntries(defined)).toMatchObject({
            Normal: "Normal", Heading1: "heading 1", Heading2: "heading 2", Heading3: "heading 3", Heading4: "heading 4", Heading5: "heading 5", Heading6: "heading 6",
            ListParagraph: "List Paragraph", Quote: "Quote", TableGrid: "Table Grid", HTMLPreformatted: "HTML Preformatted", HTMLCode: "HTML Code", Hyperlink: "Hyperlink",
        });
        // Headings take the theme's heading font and colour, so a new theme restyles them.
        expect(text("word/styles.xml")).toMatch(/w:styleId="Heading1">.*w:asciiTheme="majorHAnsi".*w:themeColor="accent1"/);
        // Every style the document uses is defined.
        const used = new Set(text("word/document.xml").match(/w:(?:pStyle|rStyle|tblStyle) w:val="[^"]+"/g)!.map(match => match.split("\"")[1]));
        for (const style of used) expect(defined.has(style), style).toBe(true);
    });

    it("turns headings, paragraphs and inline formatting into Word structure", async () => {
        const { xml, text } = await convert(SAMPLE);
        const doc = xml("word/document.xml");
        const paragraphs = byTag(doc, W, "p");
        const headings = paragraphs.map(styleOf).filter(style => style?.startsWith("Heading"));
        expect(headings).toEqual(["Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"]);
        const body = text("word/document.xml");
        expect(body).toMatch(/<w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">bold<\/w:t><\/w:r>/);
        expect(body).toMatch(/<w:r><w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">italic<\/w:t><\/w:r>/);
        expect(body).toMatch(/<w:r><w:rPr><w:strike\/><\/w:rPr><w:t xml:space="preserve">struck<\/w:t><\/w:r>/);
        expect(body).toMatch(/<w:r><w:rPr><w:rStyle w:val="HTMLCode"\/><\/w:rPr><w:t xml:space="preserve">inline code<\/w:t><\/w:r>/);
        // A horizontal rule is a paragraph with a rule under it; this one comes after the table, so it has space above.
        expect(body).toContain("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"auto\"/></w:pBdr><w:spacing w:before=\"160\"/></w:pPr></w:p>");
    });

    it("links to web addresses and to headings in the document", async () => {
        const { xml, text } = await convert(SAMPLE);
        const rels = [...xml("word/_rels/document.xml.rels").getElementsByTagName("Relationship")];
        const link = rels.find(rel => rel.getAttribute("Target") === "https://example.com/a?b=1&c=2");
        expect(link?.getAttribute("TargetMode")).toBe("External");
        expect(link?.getAttribute("Type")).toBe("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink");
        const body = text("word/document.xml");
        expect(body).toContain(`<w:hyperlink r:id="${link!.getAttribute("Id")}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">link</w:t></w:r></w:hyperlink>`);
        // [jump](#results) goes to the Results heading's bookmark.
        expect(body).toMatch(/<w:bookmarkStart w:id="\d+" w:name="_results"\/><w:r><w:t xml:space="preserve">Results<\/w:t><\/w:r><w:bookmarkEnd/);
        expect(body).toContain("<w:hyperlink w:anchor=\"_results\" w:history=\"1\">");
    });

    it("numbers lists with Word's numbering, nests them and keeps their start numbers", async () => {
        const { xml } = await convert(SAMPLE);
        const doc = xml("word/document.xml");
        const listParagraphs = byTag(doc, W, "p").filter(p => styleOf(p) === "ListParagraph");
        const numbering = listParagraphs.map(p => {
            const numPr = p.getElementsByTagNameNS(W, "numPr")[0];
            return numPr ? `${attr(numPr.getElementsByTagNameNS(W, "numId")[0], "val")}/${attr(numPr.getElementsByTagNameNS(W, "ilvl")[0], "val")}` : "none";
        });
        // Bullets share numId 1; the nested bullet is level 1; the ordered list has its own; task items carry check boxes instead.
        expect(numbering).toEqual(["1/0", "1/1", "1/0", "2/0", "2/0", "none", "none"]);
        const numberingDoc = xml("word/numbering.xml");
        const abstract = byTag(numberingDoc, W, "abstractNum").find(node => attr(node, "abstractNumId") === "1")!;
        const firstLevel = abstract.getElementsByTagNameNS(W, "lvl")[0];
        expect(attr(firstLevel.getElementsByTagNameNS(W, "start")[0], "val")).toBe("3");
        expect(attr(firstLevel.getElementsByTagNameNS(W, "numFmt")[0], "val")).toBe("decimal");
        expect(attr(firstLevel.getElementsByTagNameNS(W, "lvlText")[0], "val")).toBe("%1.");
        const bullets = byTag(numberingDoc, W, "abstractNum").find(node => attr(node, "abstractNumId") === "0")!;
        expect(attr(bullets.getElementsByTagNameNS(W, "numFmt")[0], "val")).toBe("bullet");
        // Every num points at a definition, and the definitions come before the nums, as Word requires.
        expect(childNames(numberingDoc.documentElement)).toEqual(["abstractNum", "abstractNum", "num", "num"]);
    });

    it("writes task list items as Word check boxes, ticked or not", async () => {
        const { text } = await convert(SAMPLE);
        const body = text("word/document.xml");
        const boxes = [...body.matchAll(/<w14:checked w14:val="(\d)"\/>/g)].map(match => match[1]);
        expect(boxes).toEqual(["1", "0"]);
        expect(body).toContain("<w14:checkedState w14:val=\"2612\" w14:font=\"MS Gothic\"/><w14:uncheckedState w14:val=\"2610\" w14:font=\"MS Gothic\"/>");
        expect(body).toMatch(/☒<\/w:t><\/w:r><\/w:sdtContent><\/w:sdt><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:r><w:t xml:space="preserve">done task/);
        // The w14 elements are marked ignorable, so readers that don't know them still open the file.
        expect(body).toMatch(/^<\?xml[^>]*>\s*<w:document [^>]*mc:Ignorable="w14"/);
    });

    it("sets quotes in Quote and code in a monospace style with its line breaks and indentation", async () => {
        const { xml, text } = await convert(SAMPLE);
        const doc = xml("word/document.xml");
        expect(byTag(doc, W, "p").map(styleOf).filter(style => style === "Quote")).toHaveLength(1);
        const body = text("word/document.xml");
        expect(body).toContain("<w:p><w:pPr><w:pStyle w:val=\"HTMLPreformatted\"/></w:pPr><w:r><w:t xml:space=\"preserve\">def f(x):</w:t><w:br/><w:t xml:space=\"preserve\">    return x * 2</w:t></w:r></w:p>");
        expect(text("word/styles.xml")).toMatch(/w:styleId="HTMLPreformatted">.*<w:rFonts w:ascii="Consolas"/);
        expect(text("word/fontTable.xml")).toMatch(/<w:font w:name="Consolas">.*?<w:family w:val="modern"\/><w:pitch w:val="fixed"\/>/);
    });

    it("builds tables in Table Grid with a repeating header row, alignment and a column grid", async () => {
        const { xml } = await convert(SAMPLE);
        const doc = xml("word/document.xml");
        const [table] = byTag(doc, W, "tbl");
        expect(attr(table.getElementsByTagNameNS(W, "tblStyle")[0], "val")).toBe("TableGrid");
        const gridCols = byTag(table as unknown as Document, W, "gridCol");
        expect(gridCols).toHaveLength(3);
        expect(gridCols.reduce((sum, col) => sum + Number(attr(col, "w")), 0)).toBe(9360);
        const rows = [...table.getElementsByTagNameNS(W, "tr")];
        expect(rows).toHaveLength(3);
        expect(rows[0].getElementsByTagNameNS(W, "tblHeader")).toHaveLength(1);
        expect(rows[1].getElementsByTagNameNS(W, "tblHeader")).toHaveLength(0);
        const headerCell = rows[0].getElementsByTagNameNS(W, "tc")[0];
        expect(attr(headerCell.getElementsByTagNameNS(W, "shd")[0], "fill")).toBe("F2F2F2");
        expect(headerCell.getElementsByTagNameNS(W, "b")).toHaveLength(1);
        const aligns = [...rows[1].getElementsByTagNameNS(W, "tc")].map(tc => attr(tc.getElementsByTagNameNS(W, "jc")[0], "val"));
        expect(aligns).toEqual([null, "center", "right"]);
    });

    it("writes equations as native Word math, inline and on their own lines", async () => {
        const { xml, text, result } = await convert(SAMPLE);
        const doc = xml("word/document.xml");
        expect(byTag(doc, M, "oMathPara")).toHaveLength(2);
        expect(byTag(doc, M, "oMath")).toHaveLength(5);
        expect(byTag(doc, M, "nary")).toHaveLength(1);
        expect(byTag(doc, M, "m")).toHaveLength(1);
        const body = text("word/document.xml");
        // Never a picture of an equation.
        expect(body).not.toContain("<w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"0\"");
        expect(result.report).toMatchObject({ equations: 6, equationsConverted: 5 });
    });

    it("keeps LaTeX it can't map as text in the code style, and says which and why", async () => {
        const { text, result } = await convert(SAMPLE);
        expect(text("word/document.xml")).toContain("<w:r><w:rPr><w:rStyle w:val=\"HTMLCode\"/></w:rPr><w:t xml:space=\"preserve\">$\\unknownthing{x}$</w:t></w:r>");
        expect(result.report.equationsAsText).toEqual([{ source: "$\\unknownthing{x}$", line: 43, reason: "\\unknownthing isn’t supported" }]);
    });

    it("embeds data: images, leaves remote ones out with their alt text, and fetches nothing", async () => {
        const { files, text, result } = await convert(SAMPLE);
        expect(files["word/media/image1.png"]).toEqual(Uint8Array.from(atob(PNG), c => c.charCodeAt(0)));
        const body = text("word/document.xml");
        expect(body).toMatch(/<wp:docPr id="1" name="Picture 1" descr="A pixel"\/>/);
        // 1 px at 96 per inch.
        expect(body).toContain("<wp:extent cx=\"9525\" cy=\"9525\"/>");
        expect(body).toContain("[Image: A chart]");
        expect(result.report).toMatchObject({ images: 2, imagesEmbedded: 1 });
        expect(result.report.imagesLeftOut).toEqual([{ name: "chart.png", line: 45, reason: "it is at a web address, and images are never downloaded" }]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(xhrOpen).not.toHaveBeenCalled();
    });

    it("counts what it converted", async () => {
        const { result } = await convert(SAMPLE);
        expect(result.report).toMatchObject<Partial<ConversionReport>>({ headings: 6, lists: 4, tables: 1, codeBlocks: 1, quotes: 1, links: 2 });
    });

    it("sizes the page as chosen: Letter or A4, with one-inch margins", async () => {
        expect((await convert("# A4", "a4")).text("word/document.xml")).toContain("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>");
        expect((await convert("# Letter")).text("word/document.xml")).toContain("<w:pgSz w:w=\"12240\" w:h=\"15840\"/>");
    });

    it("never writes characters XML can't hold, and never a table at the end of the body", async () => {
        const { text, xml, result } = await convert("Bell\u{7} and \u{1} stray, $\\text{a\u{ffff}b}$ and $x\u{fffe}$\n\n| a |\n| - |\n| 1 |");
        xml("word/document.xml");
        expect(text("word/document.xml")).toContain("Bell and  stray");
        expect(text("word/document.xml")).not.toMatch(/[\u{fffe}\u{ffff}]/u);
        expect(result.report.equations).toBe(2);
        expect(text("word/document.xml")).toMatch(/<\/w:tbl><w:p\/><w:sectPr>/);
    });

    it("keeps tables apart and indents what sits in quotes and list items", async () => {
        const { text, xml } = await convert("- item\n\n  | a |\n  | - |\n  | 1 |\n| b |\n| - |\n| 2 |\n\n> - quoted item\n>\n>   ```\n>   code\n>   ```");
        const body = text("word/document.xml");
        expect(body).not.toContain("</w:tbl><w:tbl>");
        expect(body).toContain("<w:tblInd w:w=\"720\" w:type=\"dxa\"/>");
        // A list inside a quote is indented past the quote, with the hanging number.
        expect(body).toMatch(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr><w:ind w:left="1440" w:hanging="360"\/>/);
        expectSchemaOrder(xml("word/document.xml"));
    });

    it("keeps tabs in code, spaces what follows a table, and bookmarks a heading that opens a list item", async () => {
        const { text, xml } = await convert([
            "```make", "all:", "\tpython train.py", "```", "",
            "| a |", "| - |", "| 1 |", "",
            "After the table.", "",
            "1. First item", "", "   Its second paragraph.", "",
            "2. ## A heading item", "",
            "> | b |", "> | - |", "> | 2 |", "",
            "After the quote's table, [back to the heading](#a-heading-item).",
        ].join("\n"));
        const body = text("word/document.xml");
        expect(body).toContain("<w:t xml:space=\"preserve\">all:</w:t><w:br/><w:tab/><w:t xml:space=\"preserve\">python train.py</w:t>");
        expect(body).toMatch(/<\/w:tbl><w:p><w:pPr><w:spacing w:before="160"\/><\/w:pPr><w:r><w:t xml:space="preserve">After the table\.<\/w:t>/);
        // After a quote that ends with a table too.
        expect(body).toMatch(/<\/w:tbl><w:p><w:pPr><w:spacing w:before="160"\/><\/w:pPr><w:r><w:t xml:space="preserve">After the quote's table/);
        // Every paragraph of a loose list's items keeps its spacing, not only the numbered one.
        expect(body).toMatch(/<w:pStyle w:val="ListParagraph"\/><w:contextualSpacing w:val="0"\/><\/w:pPr><w:r><w:t xml:space="preserve">Its second paragraph\.<\/w:t>/);
        expect(body).toMatch(/<w:bookmarkStart w:id="\d+" w:name="_a_heading_item"\/><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">A heading item<\/w:t><\/w:r><w:bookmarkEnd w:id="\d+"\/>/);
        expect(body).toContain("<w:hyperlink w:anchor=\"_a_heading_item\" w:history=\"1\">");
        expectSchemaOrder(xml("word/document.xml"));
    });

    it("handles an empty document and one of only comments", async () => {
        for (const markdown of ["", "<!-- nothing -->"]) {
            const { text } = await convert(markdown);
            expect(text("word/document.xml")).toContain("<w:body><w:p/><w:sectPr>");
        }
    });

    it("refuses Markdown over the size limit", async () => {
        await expect(convertMarkdownToDocx("x".repeat(MAX_MARKDOWN_CHARS + 1), { page: "letter" })).rejects.toMatchObject({ __kind: "too_large" });
    });

    it("loads Temml only when there are equations", async () => {
        const load = vi.fn(async () => temml);
        await convertMarkdownToDocx("# No math here, only $5 and $10", { page: "letter", loadTemml: load });
        expect(load).not.toHaveBeenCalled();
        await convertMarkdownToDocx("$x$", { page: "letter", loadTemml: load });
        expect(load).toHaveBeenCalledTimes(1);
    });
});

describe("Markdown to Word: pieces", () => {
    it("finds every equation, wherever it sits", () => {
        const doc = parseMarkdown("$a$\n\n> $b$\n\n- $c$\n\n| $d$ |\n| - |\n| $e$ |\n\n$$f$$\n\n[$g$](https://x.example)");
        expect(collectMath(doc).map(node => node.tex)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    });

    it("names the file from the title or the source file", () => {
        expect(docxFileName("notes.md")).toBe("notes.docx");
        expect(docxFileName("Quarterly report: Q3/Q4?")).toBe("Quarterly report Q3 Q4.docx");
        expect(docxFileName("   ")).toBe("document.docx");
        expect(docxFileName("x".repeat(200))).toBe(`${"x".repeat(80)}.docx`);
    });

    it("shares a table's width by what each column holds", () => {
        const table = parseMarkdown("| id | a much longer description column | n |\n|---|---|---|\n| 1 | text | 2 |").children[0];
        if (table.type !== "table") throw new Error();
        const widths = columnWidths(table, 9360);
        expect(widths.reduce((sum, width) => sum + width, 0)).toBe(9360);
        expect(widths[1]).toBeGreaterThan(widths[0]);
        expect(Math.min(...widths)).toBeGreaterThanOrEqual(720);
        const wide = parseMarkdown(`|${" c |".repeat(20)}\n|${"---|".repeat(20)}`).children[0];
        if (wide.type !== "table") throw new Error();
        const many = columnWidths(wide, 9360);
        expect(many).toHaveLength(20);
        expect(many.reduce((sum, width) => sum + width, 0)).toBe(9360);
    });

    it("reads image sizes from PNG, GIF and JPEG headers", () => {
        const bytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        expect(imageSize(bytes(PNG), "png")).toEqual({ width: 1, height: 1 });
        expect(imageSize(bytes(GIF), "gif")).toEqual({ width: 3, height: 2 });
        expect(imageSize(bytes(JPEG), "jpeg")).toEqual({ width: 640, height: 480 });
        expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
    });

    it("embeds only PNG, JPEG and GIF from data: URIs", () => {
        expect(readImageSource(`data:image/png;base64,${PNG}`)).toMatchObject({ ok: true, image: { format: "png", width: 1, height: 1 } });
        expect(readImageSource(`data:image/gif;base64,${GIF}`)).toMatchObject({ ok: true, image: { format: "gif" } });
        expect(readImageSource(`data:image/jpeg;base64,${JPEG}`)).toMatchObject({ ok: true, image: { format: "jpeg", width: 640, height: 480 } });
        expect(readImageSource("https://example.com/a.png")).toEqual({ ok: false, reason: "it is at a web address, and images are never downloaded" });
        expect(readImageSource("images/a.png")).toEqual({ ok: false, reason: "it is a file that isn’t in the Markdown" });
        expect(readImageSource("data:image/svg+xml;utf8,<svg/>")).toEqual({ ok: false, reason: "SVG images aren’t supported; PNG, JPEG and GIF are" });
        expect(readImageSource(`data:image/webp;base64,${btoa("RIFF0000WEBPVP8 ")}`)).toEqual({ ok: false, reason: "WebP images aren’t supported; PNG, JPEG and GIF are" });
        expect(readImageSource("data:image/png;base64,not base64!")).toEqual({ ok: false, reason: "its data couldn’t be read" });
    });

    it("names a left-out image by its file, its alt text or its line", () => {
        expect(imageName("https://example.com/img/chart%201.png?x=1", "Chart", 3)).toBe("chart 1.png");
        expect(imageName("https://example.com/", "A diagram", 3)).toBe("A diagram");
        expect(imageName("data:image/webp;base64,AAAA", "", 7)).toBe("The image on line 7");
    });
});
