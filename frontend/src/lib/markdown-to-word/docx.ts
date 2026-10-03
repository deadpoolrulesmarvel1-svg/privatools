/**
 * A Markdown document tree to the parts of a Word document.
 *
 * Every construct becomes real Word structure: headings in Heading 1–6,
 * lists numbered by Word (with their own start numbers) in List Paragraph,
 * task lists as check box controls, block quotes in Quote, code in HTML
 * Preformatted with its line breaks, tables in Table Grid with a header row
 * that repeats on each page, links as hyperlinks, equations as Word
 * equations. Equations the converter could not map stay as their LaTeX, in
 * the code style, and are reported; images are embedded only from data: URIs
 * and the others are reported, with their alt text left in the document.
 */
import { inlineText, type Align, type Block, type Inline, type MarkdownDocument } from "./markdown";
import type { MathResult } from "./math";
import { imageName, readImageSource, type EmbeddedImage } from "./images";
import {
    LIST_HANGING, LIST_INDENT, MAX_LIST_LEVEL, REL, contentTypesXml, coreXml, documentXml, FONT_TABLE_XML, numberingXml,
    PACKAGE_RELS, pPr, relationshipsXml, rPr, sectionProperties, SETTINGS_XML, STYLES_XML, textRun, textWidth, THEME_XML,
    xmlAttr, xmlText, type OrderedList, type PageSize, type ParagraphProps, type Relationship, type RunProps,
} from "./ooxml";

export interface ReportedEquation { source: string; line: number; reason: string }
export interface ReportedImage { name: string; line: number; reason: string }

export interface ConversionReport {
    headings: number;
    paragraphs: number;
    lists: number;
    tables: number;
    codeBlocks: number;
    quotes: number;
    links: number;
    equations: number;
    equationsConverted: number;
    /** Equations kept as their LaTeX, in document order. */
    equationsAsText: ReportedEquation[];
    images: number;
    imagesEmbedded: number;
    /** Images left out, in document order; their alt text is in the document. */
    imagesLeftOut: ReportedImage[];
}

export interface DocxParts {
    /** Every part of the package, by its path inside the ZIP. */
    files: Record<string, Uint8Array>;
    report: ConversionReport;
}

export interface WriteOptions {
    page: PageSize;
    title: string;
    made?: Date;
    /** Each math node's conversion, from convert.ts. */
    math: Map<object, MathResult>;
}

interface Context {
    /** Where block content starts, in twentieths of a point from the margin. */
    indent: number;
    /** Block quotes around this content. */
    quote: number;
    /** List levels around this content: -1 outside a list. */
    list: number;
}

const ROOT: Context = { indent: 0, quote: 0, list: -1 };
const HYPERLINK: RunProps = { style: "Hyperlink" };
const CODE: RunProps = { style: "HTMLCode" };
const EMU_PER_TWIP = 635;
const EMU_PER_PIXEL = 9525;
/** The tallest an image is drawn: most of a page's text height. */
const MAX_IMAGE_HEIGHT_EMU = 7 * 914400;
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** GitHub's heading anchors: lower case, punctuation removed, spaces as hyphens, repeats numbered. */
function slugify(text: string, used: Map<string, number>): string {
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const count = used.get(base);
    used.set(base, (count ?? -1) + 1);
    return count === undefined ? base : `${base}-${count + 1}`;
}

/** A hidden Word bookmark name for a heading: letters, digits and underscores, at most 40 characters. */
function bookmarkName(slug: string, index: number, taken: Set<string>): string {
    const ascii = slug.normalize("NFD").replace(/[\u{300}-\u{36f}]/gu, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    let name = `_${ascii || `heading_${index + 1}`}`.slice(0, 40);
    for (let n = 2; taken.has(name); n++) name = `${name.slice(0, 40 - String(n).length - 1)}_${n}`;
    taken.add(name);
    return name;
}

export class DocxWriter {
    private readonly relationships: Relationship[] = [
        { id: "rId1", type: REL.styles, target: "styles.xml" },
        { id: "rId2", type: REL.numbering, target: "numbering.xml" },
        { id: "rId3", type: REL.settings, target: "settings.xml" },
        { id: "rId4", type: REL.fontTable, target: "fontTable.xml" },
        { id: "rId5", type: REL.theme, target: "theme/theme1.xml" },
    ];
    private readonly hyperlinks = new Map<string, string>();
    private readonly media: { path: string; bytes: Uint8Array; extension: string }[] = [];
    private readonly ordered: OrderedList[] = [];
    private readonly bookmarks = new Map<string, string>();
    private readonly headingBookmarks = new Map<object, string>();
    private bookmarkId = 0;
    private drawingId = 0;
    private controlId = 0x2a3b0000;
    private readonly width: number;
    readonly report: ConversionReport = {
        headings: 0, paragraphs: 0, lists: 0, tables: 0, codeBlocks: 0, quotes: 0, links: 0,
        equations: 0, equationsConverted: 0, equationsAsText: [], images: 0, imagesEmbedded: 0, imagesLeftOut: [],
    };

    constructor(private readonly options: WriteOptions) {
        this.width = textWidth(options.page);
    }

    write(document: MarkdownDocument): DocxParts {
        this.planBookmarks(document.children);
        // Word joins tables that touch, wherever they came from, and a body must not end on one.
        let content = this.blocks(document.children, ROOT).replace(/<\/w:tbl><w:tbl>/g, "</w:tbl><w:p/><w:tbl>");
        if (!content || content.endsWith("</w:tbl>")) content += "<w:p/>";
        const body = content + sectionProperties(this.options.page);
        const encoder = new TextEncoder();
        const files: Record<string, Uint8Array> = {
            "[Content_Types].xml": encoder.encode(contentTypesXml(this.media.map(item => item.extension))),
            "_rels/.rels": encoder.encode(PACKAGE_RELS),
            "docProps/core.xml": encoder.encode(coreXml(this.options.title, this.options.made ?? new Date())),
            "word/document.xml": encoder.encode(documentXml(body)),
            "word/_rels/document.xml.rels": encoder.encode(relationshipsXml(this.relationships)),
            "word/styles.xml": encoder.encode(STYLES_XML),
            "word/numbering.xml": encoder.encode(numberingXml(this.ordered)),
            "word/settings.xml": encoder.encode(SETTINGS_XML),
            "word/fontTable.xml": encoder.encode(FONT_TABLE_XML),
            "word/theme/theme1.xml": encoder.encode(THEME_XML),
        };
        for (const item of this.media) files[`word/${item.path}`] = item.bytes;
        return { files, report: this.report };
    }

    // ── Bookmarks, so [links](#a-heading) jump to the heading ────────────────

    private planBookmarks(blocks: Block[]) {
        const used = new Map<string, number>();
        const taken = new Set<string>();
        let index = 0;
        const visit = (list: Block[]) => {
            for (const block of list) {
                if (block.type === "heading") {
                    const slug = slugify(inlineText(block.children).trim(), used);
                    const name = bookmarkName(slug, index++, taken);
                    this.headingBookmarks.set(block, name);
                    if (!this.bookmarks.has(slug)) this.bookmarks.set(slug, name);
                } else if (block.type === "blockquote") visit(block.children);
                else if (block.type === "list") for (const item of block.items) visit(item.children);
            }
        };
        visit(blocks);
    }

    // ── Blocks ────────────────────────────────────────────────────────────────

    private blocks(blocks: Block[], context: Context): string {
        let out = "";
        for (const block of blocks) out += this.block(block, context);
        return out;
    }

    /** A paragraph's style and indent for where it sits: in a quote, in a list item, or in the body. */
    private textParagraph(context: Context): ParagraphProps {
        if (context.quote > 0) return { style: "Quote", indent: context.indent !== LIST_INDENT ? { left: context.indent } : undefined };
        if (context.list >= 0) return { style: "ListParagraph", indent: context.indent !== LIST_INDENT ? { left: context.indent } : undefined };
        return context.indent ? { indent: { left: context.indent } } : {};
    }

    private block(block: Block, context: Context): string {
        switch (block.type) {
            case "heading": {
                this.report.headings++;
                const name = this.headingBookmarks.get(block);
                const id = this.bookmarkId++;
                const props: ParagraphProps = { style: `Heading${block.level}`, indent: context.indent ? { left: context.indent } : undefined };
                const content = this.inlines(block.children, {});
                return `<w:p>${pPr(props)}${name ? `<w:bookmarkStart w:id="${id}" w:name="${name}"/>` : ""}${content}${name ? `<w:bookmarkEnd w:id="${id}"/>` : ""}</w:p>`;
            }
            case "paragraph":
                this.report.paragraphs++;
                return this.paragraph(block.children, this.textParagraph(context));
            case "thematicBreak":
                return `<w:p>${pPr({ bottomRule: true, indent: context.indent ? { left: context.indent } : undefined })}</w:p>`;
            case "code":
                this.report.codeBlocks++;
                return this.codeBlock(block.value, context);
            case "math":
                return this.displayMath(block, context);
            case "blockquote":
                this.report.quotes++;
                if (!block.children.length) return "";
                return this.blocks(block.children, { indent: context.indent + LIST_INDENT, quote: context.quote + 1, list: context.list });
            case "list":
                this.report.lists++;
                return this.list(block, context);
            case "table":
                this.report.tables++;
                return this.table(block, context);
        }
    }

    private paragraph(inlines: Inline[], props: ParagraphProps): string {
        // A paragraph that is only display math ($$ … $$ written inline) is an equation paragraph.
        const meaningful = inlines.filter(node => !(node.type === "text" && !node.value.trim()) && node.type !== "softbreak");
        if (meaningful.length === 1 && meaningful[0].type === "math" && meaningful[0].display) {
            return this.equationParagraph(meaningful[0], meaningful[0].source, props);
        }
        return `<w:p>${pPr(props)}${this.inlines(inlines, {})}</w:p>`;
    }

    private codeBlock(value: string, context: Context): string {
        const lines = value.split("\n");
        let runContent = "";
        lines.forEach((line, index) => {
            if (index > 0) runContent += "<w:br/>";
            if (line) runContent += `<w:t xml:space="preserve">${xmlText(line)}</w:t>`;
        });
        return `<w:p>${pPr({ style: "HTMLPreformatted", indent: context.indent ? { left: context.indent + 96, right: 96 } : undefined })}${runContent ? `<w:r>${runContent}</w:r>` : ""}</w:p>`;
    }

    private displayMath(block: Extract<Block, { type: "math" }>, context: Context): string {
        return this.equationParagraph(block, block.source, this.textParagraph(context));
    }

    /** An equation on a line of its own, or its LaTeX in the code style when it couldn't be mapped. */
    private equationParagraph(node: object & { line: number }, source: string, props: ParagraphProps): string {
        const result = this.mathResult(node, source);
        if (result.ok) return `<w:p>${pPr(props)}<m:oMathPara><m:oMath>${result.omml}</m:oMath></m:oMathPara></w:p>`;
        return `<w:p>${pPr(props)}${textRun(source, CODE)}</w:p>`;
    }

    private mathResult(node: object & { line: number }, source: string): MathResult {
        this.report.equations++;
        const result = this.options.math.get(node) ?? { ok: false, reason: "it couldn’t be read" };
        if (result.ok === false) this.report.equationsAsText.push({ source, line: node.line, reason: result.reason });
        else this.report.equationsConverted++;
        return result;
    }

    // ── Lists ─────────────────────────────────────────────────────────────────

    private list(list: Extract<Block, { type: "list" }>, context: Context): string {
        const level = Math.min(MAX_LIST_LEVEL, context.list + 1);
        const textIndent = context.indent + LIST_INDENT;
        const allTasks = list.items.length > 0 && list.items.every(item => item.checked !== null);
        let numId = 1;
        if (list.ordered && !allTasks) {
            this.ordered.push({ level, start: list.start, delimiter: list.delimiter ?? "." });
            numId = this.ordered.length + 1;
        }
        const itemContext: Context = { indent: textIndent, quote: context.quote, list: level };
        // Where Word's numbering would put this level, the paragraph needs no indent of its own.
        const ownIndent = textIndent !== LIST_INDENT * (level + 1);
        let out = "";
        for (const item of list.items) {
            const first = item.children[0];
            const props: ParagraphProps = { style: "ListParagraph" };
            if (allTasks) props.indent = { left: textIndent - LIST_HANGING };
            else {
                props.numbering = { numId, level };
                if (ownIndent) props.indent = { left: textIndent, hanging: LIST_HANGING };
            }
            if (!list.tight) props.contextualSpacing = false;
            const box = item.checked === null ? "" : this.checkBox(item.checked);
            let rest = item.children;
            if (first && (first.type === "paragraph" || first.type === "heading")) {
                if (first.type === "paragraph") this.report.paragraphs++;
                else this.report.headings++;
                const inline = this.inlines(first.children, first.type === "heading" ? { bold: true } : {});
                out += `<w:p>${pPr(props)}${box}${inline}</w:p>`;
                rest = item.children.slice(1);
            } else {
                // An item that starts with a code block, a table or a list still gets its number, on a line of its own.
                out += `<w:p>${pPr(props)}${box}</w:p>`;
            }
            out += this.blocks(rest, itemContext);
        }
        return out;
    }

    /** A Word check box control, ticked or not, followed by a space. */
    private checkBox(checked: boolean): string {
        const id = this.controlId++;
        const glyph = checked ? "☒" : "☐";
        return `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>`
            + `<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${glyph}</w:t></w:r></w:sdtContent></w:sdt>`
            + textRun(" ");
    }

    // ── Tables ────────────────────────────────────────────────────────────────

    private table(table: Extract<Block, { type: "table" }>, context: Context): string {
        const columns = table.align.length;
        const available = Math.max(2000, this.width - context.indent);
        const widths = columnWidths(table, available);
        // Wide tables get smaller text so their columns stay readable on the page.
        const size = columns >= 10 ? 16 : columns >= 7 ? 18 : undefined;
        const base: RunProps = size ? { size } : {};
        const cell = (content: Inline[], width: number, align: Align, header: boolean) => {
            const props: ParagraphProps = { spacing: { after: 0, line: 240 }, align: align === "center" ? "center" : align === "right" ? "right" : undefined, mark: size ? { size } : undefined };
            const shading = header ? "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F2F2F2\"/>" : "";
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shading}</w:tcPr><w:p>${pPr(props)}${this.inlines(content, header ? { ...base, bold: true } : base)}</w:p></w:tc>`;
        };
        const row = (cells: Inline[][], header: boolean) => `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((content, index) => cell(content, widths[index], table.align[index], header)).join("")}</w:tr>`;
        const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${available}" w:type="dxa"/>${context.indent ? `<w:tblInd w:w="${context.indent}" w:type="dxa"/>` : ""}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
        const grid = `<w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
        return `<w:tbl>${tblPr}${grid}${row(table.head, true)}${table.rows.map(cells => row(cells, false)).join("")}</w:tbl>`;
    }

    // ── Inline content ────────────────────────────────────────────────────────

    private inlines(nodes: Inline[], props: RunProps, inLink = false): string {
        let out = "";
        for (const node of nodes) out += this.inline(node, props, inLink);
        return out;
    }

    private inline(node: Inline, props: RunProps, inLink: boolean): string {
        switch (node.type) {
            case "text": return textRun(node.value, props);
            case "softbreak": return textRun(" ", props);
            case "break": return "<w:r><w:br/></w:r>";
            case "strong": return this.inlines(node.children, { ...props, bold: true }, inLink);
            case "emphasis": return this.inlines(node.children, { ...props, italic: true }, inLink);
            case "strike": return this.inlines(node.children, { ...props, strike: true }, inLink);
            case "format":
                switch (node.format) {
                    case "underline": return this.inlines(node.children, { ...props, underline: true }, inLink);
                    case "superscript": return this.inlines(node.children, { ...props, vertAlign: "superscript" }, inLink);
                    case "subscript": return this.inlines(node.children, { ...props, vertAlign: "subscript" }, inLink);
                    case "highlight": return this.inlines(node.children, { ...props, highlight: "yellow" }, inLink);
                    case "code": return this.inlines(node.children, inLink ? { ...props, font: "Consolas" } : { ...props, ...CODE }, inLink);
                }
                return "";
            case "code": return textRun(node.value, inLink ? { ...props, font: "Consolas" } : { ...props, ...CODE });
            case "link": return this.link(node, props, inLink);
            case "image": return this.image(node, props, inLink);
            case "math": {
                const result = this.mathResult(node, node.source);
                if (result.ok) return `<m:oMath>${result.omml}</m:oMath>`;
                return textRun(node.source, inLink ? { ...props, font: "Consolas" } : { ...props, ...CODE });
            }
        }
    }

    /** A hyperlink for web and e-mail addresses and for headings in the document; any other target keeps only its text. */
    private link(node: Extract<Inline, { type: "link" }>, props: RunProps, inLink: boolean): string {
        if (inLink) return this.inlines(node.children, props, true);
        const href = node.href.trim();
        let open = "";
        if (href.startsWith("#")) {
            let slug = href.slice(1);
            try { slug = decodeURIComponent(slug); } catch { /* as written */ }
            const bookmark = this.bookmarks.get(slug.toLowerCase());
            if (bookmark) open = `<w:hyperlink w:anchor="${bookmark}" w:history="1">`;
        } else {
            const id = this.hyperlinkId(href);
            if (id) open = `<w:hyperlink r:id="${id}" w:history="1">`;
        }
        if (!open) return this.inlines(node.children, props);
        this.report.links++;
        // Equations can't sit inside a hyperlink, so a link around one is split around it.
        let out = "";
        let segment: Inline[] = [];
        const flush = () => {
            if (segment.length) out += `${open}${this.inlines(segment, { ...props, ...HYPERLINK }, true)}</w:hyperlink>`;
            segment = [];
        };
        for (const child of node.children) {
            if (child.type === "math") { flush(); out += this.inline(child, props, false); }
            else segment.push(child);
        }
        flush();
        return out;
    }

    private hyperlinkId(href: string): string | null {
        let url: URL;
        try { url = new URL(href); } catch { return null; }
        if (!SAFE_SCHEMES.has(url.protocol)) return null;
        const target = url.href;
        const known = this.hyperlinks.get(target);
        if (known) return known;
        const id = `rId${this.relationships.length + 1}`;
        this.relationships.push({ id, type: REL.hyperlink, target, external: true });
        this.hyperlinks.set(target, id);
        return id;
    }

    private image(node: Extract<Inline, { type: "image" }>, props: RunProps, inLink: boolean): string {
        this.report.images++;
        const source = readImageSource(node.src);
        if (source.ok === false) {
            const name = imageName(node.src, node.alt, node.line);
            this.report.imagesLeftOut.push({ name, line: node.line, reason: source.reason });
            // The alt text stays where the image was, linked to the image's address when it is on the web
            // (a link only: nothing is downloaded), unless the image is already inside a link.
            const placeholder = `[Image: ${node.alt.trim() || name}]`;
            const id = !inLink && /^https?:\/\//i.test(node.src.trim()) ? this.hyperlinkId(node.src.trim()) : null;
            if (id) return `<w:hyperlink r:id="${id}" w:history="1">${textRun(placeholder, { ...props, ...HYPERLINK, italic: true })}</w:hyperlink>`;
            return textRun(placeholder, { ...props, italic: true });
        }
        this.report.imagesEmbedded++;
        return this.drawing(source.image, node.alt.trim() || node.title.trim());
    }

    private drawing(image: EmbeddedImage, description: string): string {
        const index = this.media.length + 1;
        const path = `media/image${index}.${image.format}`;
        this.media.push({ path, bytes: image.bytes, extension: image.format });
        const id = `rId${this.relationships.length + 1}`;
        this.relationships.push({ id, type: REL.image, target: path });
        // Its own size at 96 pixels an inch, shrunk to fit the text width and most of a page's height.
        let cx = image.width * EMU_PER_PIXEL;
        let cy = image.height * EMU_PER_PIXEL;
        const maxWidth = this.width * EMU_PER_TWIP;
        const scale = Math.min(1, maxWidth / cx, MAX_IMAGE_HEIGHT_EMU / cy);
        cx = Math.max(1, Math.round(cx * scale));
        cy = Math.max(1, Math.round(cy * scale));
        const drawingId = ++this.drawingId;
        const name = `Picture ${drawingId}`;
        const descr = description ? ` descr="${xmlAttr(description)}"` : "";
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
            + `<wp:docPr id="${drawingId}" name="${name}"${descr}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
            + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="image${index}.${image.format}"${descr}/><pic:cNvPicPr/></pic:nvPicPr>`
            + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
            + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
}

/** Column widths that share the available width by how much each column holds, none narrower than half an inch when they fit. */
export function columnWidths(table: Extract<Block, { type: "table" }>, available: number): number[] {
    const columns = table.align.length;
    const minimum = Math.min(720, Math.floor(available / columns));
    const weights = table.align.map((_align, index) => {
        const lengths = [table.head[index], ...table.rows.map(row => row[index])].map(cell => inlineText(cell ?? []).length);
        return Math.min(60, Math.max(4, ...lengths));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let widths = weights.map(weight => Math.max(minimum, Math.floor((available * weight) / total)));
    // Columns raised to the minimum take their width from the others.
    const excess = widths.reduce((sum, width) => sum + width, 0) - available;
    if (excess > 0) {
        const flexible = widths.map((width, index) => ({ width, index })).filter(entry => entry.width > minimum);
        const room = flexible.reduce((sum, entry) => sum + (entry.width - minimum), 0);
        if (room > 0) for (const entry of flexible) widths[entry.index] -= Math.floor((excess * (entry.width - minimum)) / room);
    }
    widths = widths.map(width => Math.max(1, width));
    widths[widths.length - 1] += available - widths.reduce((sum, width) => sum + width, 0);
    return widths;
}
