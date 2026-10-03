/**
 * Markdown to Word on hostile and random input: it must finish, quickly, and
 * never write a document Word can't read. Each pathological case below is
 * about 100,000 characters; a quadratic path in the parser takes minutes on
 * them, so the time limits are generous on purpose and still catch one. The
 * e-mail, entity-ending and invalid-domain cases are bigger, because their
 * slow paths needed more to show: before their fixes they took 40 to 74
 * seconds.
 */
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import temml from "temml";
import { parseMarkdown } from "./markdown";
import { convertMarkdownToDocx } from "./convert";

function timed<T>(work: () => T): { result: T; ms: number } {
    const start = performance.now();
    const result = work();
    return { result, ms: performance.now() - start };
}

const PATHOLOGICAL: [string, string][] = [
    ["unmatched backtick runs", "`` a`".repeat(20000)],
    ["unclosed \\(", "\\(a ".repeat(25000)],
    ["unclosed comments", "<!--".repeat(25000)],
    ["unclosed processing instructions", "<?a ".repeat(25000)],
    ["unclosed CDATA", "<![CDATA[".repeat(10000)],
    ["unclosed tags", "<a href=\"x\" ".repeat(10000)],
    ["open brackets then closing ones", `${"[".repeat(30000)}${"]".repeat(30000)}`],
    ["nested link brackets", `${"[a".repeat(20000)}${"](b)".repeat(20000)}`],
    ["long shortcut labels", `[${"x".repeat(100000)}]`],
    ["emphasis runs", "*a ".repeat(30000)],
    ["underscore runs", "_a_b ".repeat(20000)],
    ["deeply nested emphasis", `${"*".repeat(20000)}a${"*".repeat(20000)}`],
    ["deeply nested HTML", `${"<b>".repeat(20000)}a${"</b>".repeat(20000)}`],
    ["dollar signs", "$a ".repeat(30000)],
    ["double dollar signs", "$$a ".repeat(25000)],
    ["deep quotes", `${"> ".repeat(20000)}x`],
    ["deep lists", Array.from({ length: 3000 }, (_, i) => `${" ".repeat(i * 2)}- item`).join("\n")],
    ["a long word with an at sign", `${"a".repeat(100000)} me@example.com`],
    ["many bare e-mail addresses", "a@b.co ".repeat(60000)],
    ["closing parentheses after an address", `www.example.com${")".repeat(80000)}`],
    ["entity-like endings after an address", `www.example.com${"&a;".repeat(100000)}`],
    ["web addresses with invalid domains", `${"(http://a._".repeat(30000)}x`],
    ["www. after underscores", "_www.a_".repeat(15000)],
    ["a long run of spaces inside a line", `a${" ".repeat(100000)}b`],
    ["a long run of tabs inside a line", `a${"\t".repeat(25000)}b`],
    ["a heading with a long run of spaces", `# a${" ".repeat(100000)}b ##`],
    ["many link reference definitions", "[a]: /u \"t\"\n".repeat(10000)],
    ["display math openers followed by text", "$$ a\n".repeat(25000)],
    ["many table rows", `| a | b |\n|---|---|\n${"| 1 | `x|y` |\n".repeat(10000)}`],
    ["entity-like text", "&#".repeat(30000)],
];

describe("Markdown to Word on hostile input", () => {
    it.each(PATHOLOGICAL)("parses %s in reasonable time", (_name, source) => {
        const { ms } = timed(() => parseMarkdown(source));
        expect(ms).toBeLessThan(5000);
    });

    it("names and bookmarks headings made of long runs quickly", async () => {
        for (const heading of [`# a${"_".repeat(100000)}b`, `# a${" .".repeat(50000)} b`]) {
            const start = performance.now();
            const result = await convertMarkdownToDocx(heading, { page: "letter", loadTemml: async () => temml });
            expect(performance.now() - start).toBeLessThan(5000);
            expect(result.title.length).toBeGreaterThan(0);
        }
    }, 60000);

    it("writes a readable document for every hostile case", async () => {
        for (const [name, source] of PATHOLOGICAL) {
            const result = await convertMarkdownToDocx(source.slice(0, 40000), { page: "letter", loadTemml: async () => temml });
            const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
            const xml = new TextDecoder().decode(files["word/document.xml"]);
            const doc = new DOMParser().parseFromString(xml, "application/xml");
            expect(doc.getElementsByTagName("parsererror"), name).toHaveLength(0);
        }
    }, 120000);
});

describe("Markdown to Word on random input", () => {
    // A small seeded generator, so a failure can be replayed.
    function random(seed: number) {
        let state = seed >>> 0;
        return () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 2 ** 32;
        };
    }
    const TOKENS = [
        "#", "## ", "- ", "* ", "1. ", "3) ", "> ", "    ", "\t", "```", "~~~", "$", "$$", "\\(", "\\)", "\\[", "\\]", "|", "|---|", ":-:",
        "*", "**", "_", "__", "~~", "`", "[", "]", "(", ")", "![", "<", ">", "&amp;", "&#x41;", "\\", "\n", "\n\n", " ", "  \n",
        "text", "x^2", "\\frac{a}{b}", "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", "<b>", "</b>", "<br>", "https://example.com/a",
        "www.example.org", "a@b.example", "[x]: https://example.com", "- [ ] ", "- [x] ", "---", "===", "<!--", "-->", "é", "😀", "\u{0}", "\u{7}",
    ];

    it("never throws while parsing 400 random documents", () => {
        const next = random(20261003);
        for (let doc = 0; doc < 400; doc++) {
            let source = "";
            const length = 1 + Math.floor(next() * 120);
            for (let i = 0; i < length; i++) source += TOKENS[Math.floor(next() * TOKENS.length)];
            expect(() => parseMarkdown(source), JSON.stringify(source)).not.toThrow();
        }
    });

    it("writes well-formed XML for 40 random documents", async () => {
        const next = random(7);
        for (let doc = 0; doc < 40; doc++) {
            let source = "";
            const length = 1 + Math.floor(next() * 200);
            for (let i = 0; i < length; i++) source += TOKENS[Math.floor(next() * TOKENS.length)];
            const result = await convertMarkdownToDocx(source, { page: "a4", loadTemml: async () => temml });
            const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
            for (const part of ["word/document.xml", "word/numbering.xml", "word/_rels/document.xml.rels"]) {
                const parsed = new DOMParser().parseFromString(new TextDecoder().decode(files[part]), "application/xml");
                expect(parsed.getElementsByTagName("parsererror"), `${part}: ${JSON.stringify(source)}`).toHaveLength(0);
            }
        }
    }, 120000);
});
