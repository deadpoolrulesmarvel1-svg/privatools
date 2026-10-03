import { describe, expect, it } from "vitest";
import { findInlineMathEnd, inlineText, parseMarkdown, splitTableRow, type Block, type Inline } from "./markdown";

const blocks = (source: string) => parseMarkdown(source).children;
const only = (source: string) => {
    const result = blocks(source);
    expect(result).toHaveLength(1);
    return result[0];
};
const inlines = (source: string): Inline[] => {
    const block = only(source);
    if (block.type !== "paragraph") throw new Error(`expected a paragraph, got ${block.type}`);
    return block.children;
};

describe("block structure", () => {
    it("reads ATX and setext headings, with closing hashes taken off", () => {
        expect(blocks("# One\n## Two ##\n###### Six\n####### Seven")).toEqual([
            { type: "heading", level: 1, children: [{ type: "text", value: "One" }], line: 1 },
            { type: "heading", level: 2, children: [{ type: "text", value: "Two" }], line: 2 },
            { type: "heading", level: 6, children: [{ type: "text", value: "Six" }], line: 3 },
            { type: "paragraph", children: [{ type: "text", value: "####### Seven" }], line: 4 },
        ]);
        expect(blocks("Title\n=====\n\nSub\n---")).toMatchObject([{ type: "heading", level: 1 }, { type: "heading", level: 2 }]);
        expect(blocks("#hashtag")).toMatchObject([{ type: "paragraph" }]);
    });

    it("joins paragraph lines with soft breaks and keeps hard breaks", () => {
        expect(inlines("one\ntwo  \nthree\\\nfour")).toEqual([
            { type: "text", value: "one" }, { type: "softbreak" }, { type: "text", value: "two" }, { type: "break" },
            { type: "text", value: "three" }, { type: "break" }, { type: "text", value: "four" },
        ]);
    });

    it("reads thematic breaks, but a --- under text as a heading", () => {
        expect(blocks("a\n\n---\n\n***\n___")).toMatchObject([{ type: "paragraph" }, { type: "thematicBreak" }, { type: "thematicBreak" }, { type: "thematicBreak" }]);
    });

    it("keeps fenced and indented code as typed, with the language", () => {
        expect(blocks("```python\ndef f(x):\n    return x  # *not emphasis*\n\n```\n\n    indented\n      more\n")).toEqual([
            { type: "code", lang: "python", value: "def f(x):\n    return x  # *not emphasis*\n", line: 1 },
            { type: "code", lang: "", value: "indented\n  more", line: 7 },
        ]);
        expect(only("~~~\nunclosed\nfence").type).toBe("code");
        expect(only("````\n```\n````")).toMatchObject({ type: "code", value: "```" });
        expect(only("\tcode with a tab")).toMatchObject({ type: "code", value: "code with a tab" });
    });

    it("nests block quotes, lists and code, with lazy continuation lines", () => {
        expect(blocks("> quote\nlazy line\n> > nested\n\n> - item")).toMatchObject([
            { type: "blockquote", children: [
                { type: "paragraph", children: [{ type: "text", value: "quote" }, { type: "softbreak" }, { type: "text", value: "lazy line" }] },
                { type: "blockquote", children: [{ type: "paragraph" }] },
            ] },
            { type: "blockquote", children: [{ type: "list", items: [{ children: [{ type: "paragraph" }] }] }] },
        ]);
    });

    it("reads bullet and ordered lists, nesting by indentation, with their start numbers", () => {
        const [list] = blocks("3. three\n4. four\n   - nested\n     1. deep\n5. five");
        expect(list).toMatchObject({ type: "list", ordered: true, start: 3, delimiter: ".", tight: true });
        if (list.type !== "list") throw new Error();
        expect(list.items).toHaveLength(3);
        expect(list.items[1].children).toMatchObject([
            { type: "paragraph" },
            { type: "list", ordered: false, items: [{ children: [{ type: "paragraph" }, { type: "list", ordered: true, start: 1 }] }] },
        ]);
    });

    it("starts a new list when the marker changes", () => {
        expect(blocks("- a\n- b\n+ c\n1) d")).toMatchObject([
            { type: "list", ordered: false, items: [{}, {}] },
            { type: "list", ordered: false, items: [{}] },
            { type: "list", ordered: true, delimiter: ")" },
        ]);
    });

    it("tells tight lists from loose ones", () => {
        expect(only("- a\n- b\n- c")).toMatchObject({ tight: true });
        expect(only("- a\n\n- b")).toMatchObject({ tight: false });
        expect(only("- a\n\n  second paragraph\n- b")).toMatchObject({ tight: false });
        expect(only("- a\n  - b\n- c")).toMatchObject({ tight: true });
    });

    it("lets only a list item that starts at 1 interrupt a paragraph", () => {
        expect(blocks("The year was\n1999. A good year.")).toMatchObject([{ type: "paragraph" }]);
        expect(blocks("Steps:\n1. first\n2. second")).toMatchObject([{ type: "paragraph" }, { type: "list", ordered: true }]);
        expect(blocks("Things:\n- one\n- two")).toMatchObject([{ type: "paragraph" }, { type: "list" }]);
    });

    it("reads task list items", () => {
        const list = only("- [ ] open\n- [x] done\n- [X] also done\n- plain\n- [ ]");
        if (list.type !== "list") throw new Error();
        expect(list.items.map(item => item.checked)).toEqual([false, true, true, null, null]);
        expect(list.items[0].children).toEqual([{ type: "paragraph", children: [{ type: "text", value: "open" }], line: 1 }]);
    });

    it("drops link reference definitions from the text and resolves them anywhere", () => {
        expect(blocks("See [the docs][d] and [Docs].\n\n[d]: https://example.com/docs \"Title\"\n[docs]: <https://example.com/x>")).toEqual([
            { type: "paragraph", line: 1, children: [
                { type: "text", value: "See " },
                { type: "link", href: "https://example.com/docs", title: "Title", children: [{ type: "text", value: "the docs" }] },
                { type: "text", value: " and " },
                { type: "link", href: "https://example.com/x", title: "", children: [{ type: "text", value: "Docs" }] },
                { type: "text", value: "." },
            ] },
        ]);
    });

    it("leaves HTML comments out", () => {
        expect(blocks("<!-- a note\n\nstill the note -->\ntext <!-- inline --> here")).toEqual([
            { type: "paragraph", line: 4, children: [{ type: "text", value: "text  here" }] },
        ]);
    });

    it("reads the line every block starts on", () => {
        expect(blocks("# A\n\ntext\n\n- item\n\n```\ncode\n```").map(block => block.line)).toEqual([1, 3, 5, 7]);
    });

    it("does not overflow on very deep nesting", () => {
        expect(() => parseMarkdown(">".repeat(5000) + " deep")).not.toThrow();
        expect(() => parseMarkdown(Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}- item`).join("\n"))).not.toThrow();
        expect(() => parseMarkdown("[".repeat(5000) + "x" + "]".repeat(5000))).not.toThrow();
    });
});

describe("tables", () => {
    it("reads a GitHub table with its alignment and pads short rows", () => {
        const table = only("| Name | Qty | Price | Note |\n|:-----|:---:|------:|------|\n| Pen | 2 | $3.50 |\n| **Ink** | 10 | $1 | `a|b` |");
        expect(table).toMatchObject({ type: "table", align: ["left", "center", "right", null], line: 1 });
        if (table.type !== "table") throw new Error();
        expect(table.head.map(inlineText)).toEqual(["Name", "Qty", "Price", "Note"]);
        expect(table.rows.map(row => row.map(inlineText))).toEqual([["Pen", "2", "$3.50", ""], ["Ink", "10", "$1", "a|b"]]);
        expect(table.rows[1][0]).toEqual([{ type: "strong", children: [{ type: "text", value: "Ink" }] }]);
    });

    it("keeps pipes inside inline math and escaped pipes in their cell", () => {
        expect(splitTableRow("| $|x|$ | a \\| b | c |")).toEqual(["$|x|$", "a | b", "c"]);
        expect(splitTableRow("| $5 | $10 |")).toEqual(["$5", "$10"]);
        expect(splitTableRow("a | b")).toEqual(["a", "b"]);
    });

    it("splits a paragraph whose last line is the header row", () => {
        expect(blocks("Intro text\n| a | b |\n| - | - |\n| 1 | 2 |")).toMatchObject([{ type: "paragraph" }, { type: "table", head: [[{ value: "a" }], [{ value: "b" }]] }]);
    });

    it("needs the header and delimiter rows to have the same cells", () => {
        expect(blocks("| a | b |\n| - |")).toMatchObject([{ type: "paragraph" }]);
    });

    it("ends at a blank line and inside a list item", () => {
        expect(blocks("| a |\n| - |\n| 1 |\n\nAfter")).toMatchObject([{ type: "table", rows: [[[{ value: "1" }]]] }, { type: "paragraph" }]);
        const list = only("- | a | b |\n  |---|---|\n  | 1 | 2 |");
        expect(list).toMatchObject({ type: "list", items: [{ children: [{ type: "table" }] }] });
    });
});

describe("math", () => {
    it("reads $…$, $$…$$ and \\(…\\) inline, with their source and line", () => {
        expect(inlines("Energy $E=mc^2$ and $$\\int x$$ and \\(a_1\\) end")).toEqual([
            { type: "text", value: "Energy " },
            { type: "math", tex: "E=mc^2", display: false, source: "$E=mc^2$", line: 1 },
            { type: "text", value: " and " },
            { type: "math", tex: "\\int x", display: true, source: "$$\\int x$$", line: 1 },
            { type: "text", value: " and " },
            { type: "math", tex: "a_1", display: false, source: "\\(a_1\\)", line: 1 },
            { type: "text", value: " end" },
        ]);
    });

    it("leaves prices, escaped dollars and lone dollars as text", () => {
        expect(inlineText(inlines("It costs $5 and $10, or \\$3 and $ 4$."))).toBe("It costs $5 and $10, or $3 and $ 4$.");
        expect(inlines("It costs $5 and $10.").every(node => node.type === "text")).toBe(true);
        expect(findInlineMathEnd("$x$1", 0)).toBe(-1);
        expect(findInlineMathEnd("$x $", 0)).toBe(-1);
        expect(findInlineMathEnd("$x$", 0)).toBe(3);
    });

    it("does not read emphasis or escapes inside math", () => {
        expect(inlines("$a_1 * b_2 * c$")).toEqual([{ type: "math", tex: "a_1 * b_2 * c", display: false, source: "$a_1 * b_2 * c$", line: 1 }]);
        expect(inlines("`$x$` is code")[0]).toEqual({ type: "code", value: "$x$" });
    });

    it("reads display math blocks, which may interrupt a paragraph", () => {
        expect(blocks("The formula:\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\nafter")).toEqual([
            { type: "paragraph", children: [{ type: "text", value: "The formula:" }], line: 1 },
            { type: "math", tex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", source: "$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$", line: 2 },
            { type: "paragraph", children: [{ type: "text", value: "after" }], line: 5 },
        ]);
        expect(blocks("\\[\n\\sum_{i=1}^n i\n\\]")).toEqual([{ type: "math", tex: "\\sum_{i=1}^n i", source: "\\[\n\\sum_{i=1}^n i\n\\]", line: 1 }]);
        expect(blocks("$$ a^2 + b^2 = c^2 $$")).toEqual([{ type: "math", tex: "a^2 + b^2 = c^2", source: "$$ a^2 + b^2 = c^2 $$", line: 1 }]);
        expect(blocks("$$x\ny$$")).toMatchObject([{ type: "math", tex: "x\ny" }]);
    });

    it("reads display math that was never closed as the text it was", () => {
        expect(blocks("$$\nx = 1\n\nNext paragraph")).toMatchObject([
            { type: "paragraph", children: [{ type: "text", value: "$$" }, { type: "softbreak" }, { type: "text", value: "x = 1" }] },
            { type: "paragraph" },
        ]);
        expect(blocks("$$ 100 left")).toMatchObject([{ type: "paragraph" }]);
    });

    it("reads math inside lists, quotes and table cells", () => {
        expect(blocks("1. Solve:\n   $$\n   x^2 = 4\n   $$\n> \\(y\\)")).toMatchObject([
            { type: "list", items: [{ children: [{ type: "paragraph" }, { type: "math", tex: "x^2 = 4" }] }] },
            { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "math", tex: "y" }] }] },
        ]);
        const table = only("| f | value |\n|---|---|\n| abs | $|x|$ |");
        if (table.type !== "table") throw new Error();
        expect(table.rows[0][1]).toEqual([{ type: "math", tex: "|x|", display: false, source: "$|x|$", line: 3 }]);
    });

    it("counts lines for math deep in a paragraph", () => {
        const block = blocks("first\n\nline three\nline four $x$")[1] as Extract<Block, { type: "paragraph" }>;
        expect(block.children.find(node => node.type === "math")).toMatchObject({ line: 4 });
    });
});

describe("inline content", () => {
    it("reads emphasis, strong and both, by CommonMark's flanking rules", () => {
        expect(inlines("*em* **strong** ***both*** _em_ __strong__")).toEqual([
            { type: "emphasis", children: [{ type: "text", value: "em" }] }, { type: "text", value: " " },
            { type: "strong", children: [{ type: "text", value: "strong" }] }, { type: "text", value: " " },
            { type: "emphasis", children: [{ type: "strong", children: [{ type: "text", value: "both" }] }] }, { type: "text", value: " " },
            { type: "emphasis", children: [{ type: "text", value: "em" }] }, { type: "text", value: " " },
            { type: "strong", children: [{ type: "text", value: "strong" }] },
        ]);
        expect(inlines("snake_case_name and 2*3*4")).toEqual([{ type: "text", value: "snake_case_name and 2" }, { type: "emphasis", children: [{ type: "text", value: "3" }] }, { type: "text", value: "4" }]);
        expect(inlineText(inlines("a * b * c"))).toBe("a * b * c");
        expect(inlines("**bold *italic* bold**")).toEqual([{ type: "strong", children: [
            { type: "text", value: "bold " }, { type: "emphasis", children: [{ type: "text", value: "italic" }] }, { type: "text", value: " bold" },
        ] }]);
    });

    it("strikes through ~~text~~ only", () => {
        expect(inlines("~~gone~~ and ~about~ ~~~three~~~")).toEqual([
            { type: "strike", children: [{ type: "text", value: "gone" }] },
            { type: "text", value: " and ~about~ ~~~three~~~" },
        ]);
    });

    it("reads code spans before anything else in them", () => {
        expect(inlines("`a *b* [c](d)` and ``x ` y``")).toEqual([
            { type: "code", value: "a *b* [c](d)" }, { type: "text", value: " and " }, { type: "code", value: "x ` y" },
        ]);
        expect(inlineText(inlines("`unclosed"))).toBe("`unclosed");
    });

    it("reads inline links, autolinks and bare web addresses", () => {
        expect(inlines("[text *em*](https://example.com/a_(b) \"T\") <https://x.org> www.example.com/page. Mail me@example.com")).toEqual([
            { type: "link", href: "https://example.com/a_(b)", title: "T", children: [{ type: "text", value: "text " }, { type: "emphasis", children: [{ type: "text", value: "em" }] }] },
            { type: "text", value: " " },
            { type: "link", href: "https://x.org", title: "", children: [{ type: "text", value: "https://x.org" }] },
            { type: "text", value: " " },
            { type: "link", href: "http://www.example.com/page", title: "", children: [{ type: "text", value: "www.example.com/page" }] },
            { type: "text", value: ". Mail " },
            { type: "link", href: "mailto:me@example.com", title: "", children: [{ type: "text", value: "me@example.com" }] },
        ]);
        expect(inlines("(see https://example.com/x)")).toEqual([
            { type: "text", value: "(see " }, { type: "link", href: "https://example.com/x", title: "", children: [{ type: "text", value: "https://example.com/x" }] }, { type: "text", value: ")" },
        ]);
        expect(inlineText(inlines("[not a link] and [x](")).trim()).toBe("[not a link] and [x](");
    });

    it("never nests a link in a link", () => {
        // As in CommonMark, the inner link wins; the outer brackets stay text (and GitHub autolinks the bare address left).
        const result = inlines("[outer [inner](https://a.example) text](/b)");
        expect(result).toEqual([
            { type: "text", value: "[outer " },
            { type: "link", href: "https://a.example", title: "", children: [{ type: "text", value: "inner" }] },
            { type: "text", value: " text](/b)" },
        ]);
        const nested = (nodes: Inline[], inLink = false): boolean => nodes.some(node => "children" in node && ((node.type === "link" && inLink) || nested(node.children, inLink || node.type === "link")));
        expect(nested(inlines("[a [b](https://x.example) c](https://y.example) [**[d](https://z.example)**](https://w.example)"))).toBe(false);
    });

    it("reads images with their alt text, remote or embedded", () => {
        expect(inlines("![A *chart*](https://example.com/chart.png \"Sales\") ![](data:image/png;base64,AAAA)")).toEqual([
            { type: "image", src: "https://example.com/chart.png", alt: "A chart", title: "Sales", line: 1 },
            { type: "text", value: " " },
            { type: "image", src: "data:image/png;base64,AAAA", alt: "", title: "", line: 1 },
        ]);
    });

    it("keeps formatting HTML, line breaks and images, and leaves other tags out", () => {
        expect(inlines("H<sub>2</sub>O x<sup>2</sup> <u>under</u> <b>bold</b> a<br>b <span class=\"x\">kept</span> <mark>hi</mark> <img src=\"https://e.example/i.png\" alt=\"pic\">")).toEqual([
            { type: "text", value: "H" }, { type: "format", format: "subscript", children: [{ type: "text", value: "2" }] },
            { type: "text", value: "O x" }, { type: "format", format: "superscript", children: [{ type: "text", value: "2" }] },
            { type: "text", value: " " }, { type: "format", format: "underline", children: [{ type: "text", value: "under" }] },
            { type: "text", value: " " }, { type: "strong", children: [{ type: "text", value: "bold" }] },
            { type: "text", value: " a" }, { type: "break" }, { type: "text", value: "b kept " },
            { type: "format", format: "highlight", children: [{ type: "text", value: "hi" }] },
            { type: "text", value: " " }, { type: "image", src: "https://e.example/i.png", alt: "pic", title: "", line: 1 },
        ]);
        expect(inlines("<a href=\"https://example.com\">site</a> and <i>unclosed")).toEqual([
            { type: "link", href: "https://example.com", title: "", children: [{ type: "text", value: "site" }] },
            { type: "text", value: " and unclosed" },
        ]);
    });

    it("decodes entities and backslash escapes", () => {
        expect(inlineText(inlines("&copy; &amp; &#169; &#xA9; &nosuch; \\*not em\\* \\_ \\a"))).toBe("© & © © &nosuch; *not em* _ \\a");
    });
});
