/**
 * The parts of a Word document (.docx) Markdown to Word writes, and the XML
 * helpers they share.
 *
 * Word is strict about the order of elements inside a paragraph's or a run's
 * properties, so those are only ever written by pPr() and rPr(), which emit
 * them in the order the schema (ECMA-376, Part 1) gives. Styles use Word's
 * own built-in names (heading 1–6, List Paragraph, Quote, Table Grid, HTML
 * Preformatted, HTML Code, Hyperlink), so the document stays editable and
 * themeable as any other Word document: change the theme or a style and the
 * text follows.
 */

export const NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
    w14: "http://schemas.microsoft.com/office/word/2010/wordml",
    mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
    rels: "http://schemas.openxmlformats.org/package/2006/relationships",
} as const;

export const REL = {
    officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    coreProperties: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
    settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
    fontTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
    theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
    hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
} as const;

const XML_DECLARATION = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

/** Characters XML 1.0 can't hold: control characters, U+FFFE/U+FFFF and unpaired surrogates. */
// eslint-disable-next-line no-control-regex -- matching control characters is this pattern's whole job
const NOT_XML = /[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{fffe}\u{ffff}\u{d800}-\u{dfff}]/gu;

export function xmlText(text: string): string {
    return text.replace(NOT_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function xmlAttr(text: string): string {
    return xmlText(text).replace(/"/g, "&quot;");
}

// ── Paragraph and run properties, in schema order ─────────────────────────────

export interface Indent { left?: number; right?: number; hanging?: number }

export interface ParagraphProps {
    style?: string;
    keepNext?: boolean;
    numbering?: { numId: number; level: number };
    /** A rule along the bottom: the thematic break. */
    bottomRule?: boolean;
    spacing?: { before?: number; after?: number; line?: number };
    indent?: Indent;
    /** Override the style's contextual spacing: false puts space between list items of a loose list. */
    contextualSpacing?: boolean;
    align?: "left" | "center" | "right";
    /** The paragraph mark's run properties. */
    mark?: RunProps;
}

export interface RunProps {
    style?: string;
    font?: string;
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    color?: string;
    /** Half-points. */
    size?: number;
    highlight?: string;
    underline?: boolean;
    shading?: string;
    vertAlign?: "superscript" | "subscript";
}

export function pPr(props: ParagraphProps): string {
    let out = "";
    if (props.style) out += `<w:pStyle w:val="${props.style}"/>`;
    if (props.keepNext) out += "<w:keepNext/>";
    if (props.numbering) out += `<w:numPr><w:ilvl w:val="${props.numbering.level}"/><w:numId w:val="${props.numbering.numId}"/></w:numPr>`;
    if (props.bottomRule) out += "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"auto\"/></w:pBdr>";
    if (props.spacing) {
        const { before, after, line } = props.spacing;
        out += `<w:spacing${before !== undefined ? ` w:before="${before}"` : ""}${after !== undefined ? ` w:after="${after}"` : ""}${line !== undefined ? ` w:line="${line}" w:lineRule="auto"` : ""}/>`;
    }
    if (props.indent) {
        const { left, right, hanging } = props.indent;
        out += `<w:ind${left !== undefined ? ` w:left="${left}"` : ""}${right !== undefined ? ` w:right="${right}"` : ""}${hanging !== undefined ? ` w:hanging="${hanging}"` : ""}/>`;
    }
    if (props.contextualSpacing !== undefined) out += props.contextualSpacing ? "<w:contextualSpacing/>" : "<w:contextualSpacing w:val=\"0\"/>";
    if (props.align) out += `<w:jc w:val="${props.align}"/>`;
    if (props.mark) {
        const mark = rPr(props.mark);
        if (mark) out += mark;
    }
    return out ? `<w:pPr>${out}</w:pPr>` : "";
}

export function rPr(props: RunProps): string {
    let out = "";
    if (props.style) out += `<w:rStyle w:val="${props.style}"/>`;
    if (props.font) out += `<w:rFonts w:ascii="${xmlAttr(props.font)}" w:hAnsi="${xmlAttr(props.font)}" w:cs="${xmlAttr(props.font)}"/>`;
    if (props.bold) out += "<w:b/><w:bCs/>";
    if (props.italic) out += "<w:i/><w:iCs/>";
    if (props.strike) out += "<w:strike/>";
    if (props.color) out += `<w:color w:val="${props.color}"/>`;
    if (props.size) out += `<w:sz w:val="${props.size}"/><w:szCs w:val="${props.size}"/>`;
    if (props.highlight) out += `<w:highlight w:val="${props.highlight}"/>`;
    if (props.underline) out += "<w:u w:val=\"single\"/>";
    if (props.shading) out += `<w:shd w:val="clear" w:color="auto" w:fill="${props.shading}"/>`;
    if (props.vertAlign) out += `<w:vertAlign w:val="${props.vertAlign}"/>`;
    return out ? `<w:rPr>${out}</w:rPr>` : "";
}

/** A run's content for some text: each tab as Word's own tab, so code indented with tabs keeps them. */
export function runText(text: string): string {
    let out = "";
    text.split("\t").forEach((part, index) => {
        if (index > 0) out += "<w:tab/>";
        if (part) out += `<w:t xml:space="preserve">${xmlText(part)}</w:t>`;
    });
    return out;
}

/** A run of text, with spaces kept as typed. */
export function textRun(text: string, props: RunProps = {}): string {
    if (!text) return "";
    return `<w:r>${rPr(props)}${runText(text)}</w:r>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export type PageSize = "letter" | "a4";

/** Page sizes in twentieths of a point, with Word's one-inch margins. */
export const PAGES: Record<PageSize, { width: number; height: number; margin: number }> = {
    letter: { width: 12240, height: 15840, margin: 1440 },
    a4: { width: 11906, height: 16838, margin: 1440 },
};

export function textWidth(page: PageSize): number {
    return PAGES[page].width - 2 * PAGES[page].margin;
}

export function sectionProperties(page: PageSize): string {
    const { width, height, margin } = PAGES[page];
    return `<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
}

// ── Static parts ──────────────────────────────────────────────────────────────

const HEADING_COLOR = "<w:color w:val=\"2F5496\" w:themeColor=\"accent1\" w:themeShade=\"BF\"/>";
const HEADING_DARK = "<w:color w:val=\"1F3763\" w:themeColor=\"accent1\" w:themeShade=\"7F\"/>";
const MAJOR_FONTS = "<w:rFonts w:asciiTheme=\"majorHAnsi\" w:eastAsiaTheme=\"majorEastAsia\" w:hAnsiTheme=\"majorHAnsi\" w:cstheme=\"majorBidi\"/>";

function heading(level: number, size: number, before: number, after: number, color: string, italic = false): string {
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/>${level > 1 ? "<w:unhideWhenUsed/>" : ""}<w:qFormat/>`
        + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>`
        + `<w:rPr>${MAJOR_FONTS}${italic ? "<w:i/><w:iCs/>" : ""}${color}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
}

const CODE_FONT = "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>";
const CODE_FILL = "F2F2F2";
const CODE_EDGE = `w:val="single" w:sz="4" w:space="4" w:color="${CODE_FILL}"`;

export const STYLES_XML = XML_DECLARATION
    + `<w:styles xmlns:w="${NS.w}">`
    + "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorEastAsia\" w:hAnsiTheme=\"minorHAnsi\" w:cstheme=\"minorBidi\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\" w:eastAsia=\"en-US\" w:bidi=\"ar-SA\"/></w:rPr></w:rPrDefault>"
    + "<w:pPrDefault><w:pPr><w:spacing w:after=\"160\" w:line=\"259\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>"
    + "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>"
    + heading(1, 32, 360, 120, HEADING_COLOR)
    + heading(2, 28, 240, 80, HEADING_COLOR)
    + heading(3, 24, 200, 60, HEADING_DARK)
    + heading(4, 22, 160, 40, HEADING_COLOR, true)
    + heading(5, 22, 160, 40, HEADING_COLOR)
    + heading(6, 22, 160, 40, HEADING_DARK, true)
    + "<w:style w:type=\"character\" w:default=\"1\" w:styleId=\"DefaultParagraphFont\"><w:name w:val=\"Default Paragraph Font\"/><w:uiPriority w:val=\"1\"/><w:semiHidden/><w:unhideWhenUsed/></w:style>"
    + "<w:style w:type=\"table\" w:default=\"1\" w:styleId=\"TableNormal\"><w:name w:val=\"Normal Table\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w=\"0\" w:type=\"dxa\"/><w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr></w:style>"
    + "<w:style w:type=\"numbering\" w:default=\"1\" w:styleId=\"NoList\"><w:name w:val=\"No List\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/></w:style>"
    + "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:uiPriority w:val=\"34\"/><w:qFormat/><w:pPr><w:ind w:left=\"720\"/><w:contextualSpacing/></w:pPr></w:style>"
    + "<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:uiPriority w:val=\"29\"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"8\" w:color=\"BFBFBF\" w:themeColor=\"background1\" w:themeShade=\"BF\"/></w:pBdr><w:spacing w:before=\"120\" w:after=\"120\"/><w:ind w:left=\"720\"/></w:pPr><w:rPr><w:color w:val=\"404040\" w:themeColor=\"text1\" w:themeTint=\"BF\"/></w:rPr></w:style>"
    + `<w:style w:type="paragraph" w:styleId="HTMLPreformatted"><w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:pBdr><w:top ${CODE_EDGE}/><w:left ${CODE_EDGE}/><w:bottom ${CODE_EDGE}/><w:right ${CODE_EDGE}/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${CODE_FILL}"/><w:spacing w:before="120" w:after="200" w:line="240" w:lineRule="auto"/><w:ind w:left="96" w:right="96"/></w:pPr><w:rPr>${CODE_FONT}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`
    + `<w:style w:type="character" w:styleId="HTMLCode"><w:name w:val="HTML Code"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr>${CODE_FONT}<w:sz w:val="20"/><w:szCs w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="${CODE_FILL}"/></w:rPr></w:style>`
    + "<w:style w:type=\"character\" w:styleId=\"Hyperlink\"><w:name w:val=\"Hyperlink\"/><w:basedOn w:val=\"DefaultParagraphFont\"/><w:uiPriority w:val=\"99\"/><w:unhideWhenUsed/><w:rPr><w:color w:val=\"0563C1\" w:themeColor=\"hyperlink\"/><w:u w:val=\"single\"/></w:rPr></w:style>"
    + "<w:style w:type=\"table\" w:styleId=\"TableGrid\"><w:name w:val=\"Table Grid\"/><w:basedOn w:val=\"TableNormal\"/><w:uiPriority w:val=\"39\"/><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/></w:tblBorders></w:tblPr></w:style>"
    + "</w:styles>";

/** The Office theme's colours and fonts (Calibri Light for headings, Calibri for text), which the styles refer to. */
export const THEME_XML = XML_DECLARATION
    + `<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements>`
    + "<a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"44546A\"/></a:dk2><a:lt2><a:srgbClr val=\"E7E6E6\"/></a:lt2><a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1><a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2><a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3><a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4><a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5><a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme>"
    + "<a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Calibri Light\" panose=\"020F0302020204030204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\" panose=\"020F0502020204030204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>"
    + "<a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>"
    + "<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>"
    + "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
    + "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>"
    + "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";

/** The fonts the styles name, with their families, so a reader without one substitutes a font of the same kind (a fixed-pitch one for code). */
export const FONT_TABLE_XML = XML_DECLARATION
    + `<w:fonts xmlns:w="${NS.w}">`
    + "<w:font w:name=\"Calibri\"><w:panose1 w:val=\"020F0502020204030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/></w:font>"
    + "<w:font w:name=\"Calibri Light\"><w:panose1 w:val=\"020F0302020204030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/></w:font>"
    + "<w:font w:name=\"Consolas\"><w:panose1 w:val=\"020B0609020204030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"modern\"/><w:pitch w:val=\"fixed\"/></w:font>"
    + "<w:font w:name=\"Cambria Math\"><w:panose1 w:val=\"02040503050406030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/></w:font>"
    + "<w:font w:name=\"MS Gothic\"><w:panose1 w:val=\"020B0609070205080204\"/><w:charset w:val=\"80\"/><w:family w:val=\"modern\"/><w:pitch w:val=\"fixed\"/></w:font>"
    + "<w:font w:name=\"Symbol\"><w:panose1 w:val=\"05050102010706020507\"/><w:charset w:val=\"02\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/></w:font>"
    + "<w:font w:name=\"Wingdings\"><w:panose1 w:val=\"05000000000000000000\"/><w:charset w:val=\"02\"/><w:family w:val=\"auto\"/><w:pitch w:val=\"variable\"/></w:font>"
    + "<w:font w:name=\"Courier New\"><w:panose1 w:val=\"02070309020205020404\"/><w:charset w:val=\"00\"/><w:family w:val=\"modern\"/><w:pitch w:val=\"fixed\"/></w:font>"
    + "</w:fonts>";

/** Word 2013 and later's compatibility mode, and the math settings Word writes for every document. */
export const SETTINGS_XML = XML_DECLARATION
    + `<w:settings xmlns:w="${NS.w}" xmlns:m="${NS.m}">`
    + "<w:zoom w:percent=\"100\"/><w:defaultTabStop w:val=\"720\"/><w:characterSpacingControl w:val=\"doNotCompress\"/>"
    + "<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/></w:compat>"
    + "<m:mathPr><m:mathFont m:val=\"Cambria Math\"/><m:brkBin m:val=\"before\"/><m:brkBinSub m:val=\"--\"/><m:smallFrac m:val=\"0\"/><m:dispDef/><m:lMargin m:val=\"0\"/><m:rMargin m:val=\"0\"/><m:defJc m:val=\"centerGroup\"/><m:wrapIndent m:val=\"1440\"/><m:intLim m:val=\"subSup\"/><m:naryLim m:val=\"undOvr\"/></m:mathPr>"
    + "<w:themeFontLang w:val=\"en-US\"/>"
    + "<w:clrSchemeMapping w:bg1=\"light1\" w:t1=\"dark1\" w:bg2=\"light2\" w:t2=\"dark2\" w:accent1=\"accent1\" w:accent2=\"accent2\" w:accent3=\"accent3\" w:accent4=\"accent4\" w:accent5=\"accent5\" w:accent6=\"accent6\" w:hyperlink=\"hyperlink\" w:followedHyperlink=\"followedHyperlink\"/>"
    + "<w:decimalSymbol w:val=\".\"/><w:listSeparator w:val=\",\"/>"
    + "</w:settings>";

// ── Numbering ─────────────────────────────────────────────────────────────────

/** Word's own bullets: a dot, a ring and a square, in Symbol, Courier New and Wingdings. */
const BULLETS: { text: string; font: string }[] = [
    { text: "\u{f0b7}", font: "Symbol" },
    { text: "o", font: "Courier New" },
    { text: "\u{f0a7}", font: "Wingdings" },
];

export const LIST_INDENT = 720;
export const LIST_HANGING = 360;
export const MAX_LIST_LEVEL = 8;

function level(index: number, body: string): string {
    return `<w:lvl w:ilvl="${index}">${body}<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${LIST_INDENT * (index + 1)}" w:hanging="${LIST_HANGING}"/></w:pPr>`;
}

function bulletDefinition(id: number): string {
    let levels = "";
    for (let i = 0; i <= MAX_LIST_LEVEL; i++) {
        const bullet = BULLETS[i % BULLETS.length];
        levels += `${level(i, `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${xmlAttr(bullet.text)}"/>`)}<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr></w:lvl>`;
    }
    return `<w:abstractNum w:abstractNumId="${id}"><w:nsid w:val="${nsid(id)}"/><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`;
}

/** Numbers at every level, as Markdown writes them: "1." or "1)". Each list has its own definition, so each starts where it says. */
function orderedDefinition(id: number, listLevel: number, start: number, delimiter: "." | ")"): string {
    let levels = "";
    for (let i = 0; i <= MAX_LIST_LEVEL; i++) {
        levels += `${level(i, `<w:start w:val="${i === listLevel ? start : 1}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${i + 1}${delimiter}"/>`)}</w:lvl>`;
    }
    return `<w:abstractNum w:abstractNumId="${id}"><w:nsid w:val="${nsid(id)}"/><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
}

function nsid(id: number): string {
    return ((0x4d2a0000 + id * 0x9e37) >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(-8);
}

export interface OrderedList { level: number; start: number; delimiter: "." | ")" }

/** numbering.xml: one bullet definition (numId 1) and one per ordered list (numId 2 onwards). */
export function numberingXml(ordered: OrderedList[]): string {
    const definitions = [bulletDefinition(0), ...ordered.map((list, index) => orderedDefinition(index + 1, list.level, list.start, list.delimiter))];
    const nums = [`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`, ...ordered.map((_list, index) => `<w:num w:numId="${index + 2}"><w:abstractNumId w:val="${index + 1}"/></w:num>`)];
    return `${XML_DECLARATION}<w:numbering xmlns:w="${NS.w}">${definitions.join("")}${nums.join("")}</w:numbering>`;
}

// ── Package parts ─────────────────────────────────────────────────────────────

export interface Relationship { id: string; type: string; target: string; external?: boolean }

export function relationshipsXml(relationships: Relationship[]): string {
    const items = relationships.map(rel => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${xmlAttr(rel.target)}"${rel.external ? " TargetMode=\"External\"" : ""}/>`);
    return `${XML_DECLARATION}<Relationships xmlns="${NS.rels}">${items.join("")}</Relationships>`;
}

const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif" };

export function contentTypesXml(mediaExtensions: string[]): string {
    const defaults = ["<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>", "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"];
    for (const extension of [...new Set(mediaExtensions)].sort()) defaults.push(`<Default Extension="${extension}" ContentType="${MEDIA_TYPES[extension]}"/>`);
    const overrides = [
        ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
        ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
        ["/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"],
        ["/word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"],
        ["/word/fontTable.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"],
        ["/word/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
        ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ].map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`);
    return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`;
}

export const PACKAGE_RELS = relationshipsXml([
    { id: "rId1", type: REL.officeDocument, target: "word/document.xml" },
    { id: "rId2", type: REL.coreProperties, target: "docProps/core.xml" },
]);

/** The document's title and when it was made; no author, so nothing about the visitor. */
export function coreXml(title: string, made: Date): string {
    const when = made.toISOString().replace(/\.\d{3}Z$/, "Z");
    return `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
        + `${title ? `<dc:title>${xmlText(title)}</dc:title>` : ""}<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`;
}

export function documentXml(body: string): string {
    return `${XML_DECLARATION}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:m="${NS.m}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:w14="${NS.w14}" xmlns:mc="${NS.mc}" mc:Ignorable="w14"><w:body>${body}</w:body></w:document>`;
}
