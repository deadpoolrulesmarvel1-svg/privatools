/**
 * The parser against CommonMark and GFM: every case in conformance-cases.ts
 * is rendered as the HTML those specifications describe and compared, so a
 * change to the hand-written parser that breaks a rule fails here. Where the
 * parser differs on purpose, DIFFERENCES says what it gives instead; each one
 * is also listed in markdown.ts's header, with its reason.
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown, type Block, type Inline } from "./markdown";
import { CONFORMANCE_CASES } from "./conformance-cases";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(nodes: Inline[]): string {
    let out = "";
    for (const node of nodes) {
        switch (node.type) {
            case "text": out += escape(node.value); break;
            case "code": out += `<code>${escape(node.value)}</code>`; break;
            case "strong": out += `<strong>${inlineHtml(node.children)}</strong>`; break;
            case "emphasis": out += `<em>${inlineHtml(node.children)}</em>`; break;
            case "strike": out += `<del>${inlineHtml(node.children)}</del>`; break;
            case "format": out += `<${node.format}>${inlineHtml(node.children)}</${node.format}>`; break;
            case "link": out += `<a href="${escape(node.href)}"${node.title ? ` title="${escape(node.title)}"` : ""}>${inlineHtml(node.children)}</a>`; break;
            case "image": out += `<img src="${escape(node.src)}" alt="${escape(node.alt)}"${node.title ? ` title="${escape(node.title)}"` : ""} />`; break;
            case "math": out += `<math${node.display ? " display" : ""}>${escape(node.tex)}</math>`; break;
            case "break": out += "<br />\n"; break;
            case "softbreak": out += "\n"; break;
        }
    }
    return out;
}

function blockHtml(blocks: Block[], tight = false): string {
    let out = "";
    for (const block of blocks) {
        switch (block.type) {
            case "heading": out += `<h${block.level}>${inlineHtml(block.children)}</h${block.level}>\n`; break;
            case "paragraph": out += tight ? `${inlineHtml(block.children)}\n` : `<p>${inlineHtml(block.children)}</p>\n`; break;
            case "thematicBreak": out += "<hr />\n"; break;
            case "code": out += `<pre><code${block.lang ? ` class="language-${escape(block.lang)}"` : ""}>${escape(block.value)}${block.value ? "\n" : ""}</code></pre>\n`; break;
            case "math": out += `<mathblock>${escape(block.tex)}</mathblock>\n`; break;
            case "blockquote": out += `<blockquote>\n${blockHtml(block.children)}</blockquote>\n`; break;
            case "list": {
                const tag = block.ordered ? "ol" : "ul";
                out += `<${tag}${block.ordered && block.start !== 1 ? ` start="${block.start}"` : ""}>\n`;
                for (const item of block.items) {
                    const box = item.checked === null ? "" : `<input type="checkbox"${item.checked ? " checked" : ""} disabled /> `;
                    let inner = blockHtml(item.children, block.tight);
                    if (block.tight) inner = inner.replace(/\n$/, "");
                    out += `<li>${box}${block.tight ? inner : inner ? `\n${inner}` : ""}</li>\n`;
                }
                out += `</${tag}>\n`;
                break;
            }
            case "table": {
                const align = (index: number) => block.align[index] ? ` align="${block.align[index]}"` : "";
                out += `<table>\n<thead>\n<tr>\n${block.head.map((cell, index) => `<th${align(index)}>${inlineHtml(cell)}</th>\n`).join("")}</tr>\n</thead>\n`;
                if (block.rows.length) out += `<tbody>\n${block.rows.map(row => `<tr>\n${row.map((cell, index) => `<td${align(index)}>${inlineHtml(cell)}</td>\n`).join("")}</tr>\n`).join("")}</tbody>\n`;
                out += "</table>\n";
                break;
            }
        }
    }
    return out;
}

/** Line breaks between tags and at the end don't count. */
const normalize = (html: string) => html.replace(/>\n</g, "><").replace(/\n+$/, "").trim();

/** Where the parser differs on purpose (see markdown.ts's header), and the HTML it gives instead. */
const DIFFERENCES: Record<string, string> = {
    // A single ~ never strikes through, so "~5 minutes" stays readable.
    "strike-491": "<p><del>Hi</del> Hello, ~there~ world!</p>",
    // HTML5's names beyond HTML 4's set stay as typed.
    "ent-common": "<p>\u{a0} &amp; © Æ &amp;Dcaron;\n¾ &amp;HilbertSpace; &amp;DifferentialD;\n&amp;ClockwiseContourIntegral; &amp;ngE;</p>",
};

describe("Markdown to Word's parser against CommonMark and GFM", () => {
    it("has a case for every listed difference", () => {
        const ids = new Set(CONFORMANCE_CASES.map(([id]) => id));
        expect(Object.keys(DIFFERENCES).filter(id => !ids.has(id))).toEqual([]);
        expect(ids.size).toBe(CONFORMANCE_CASES.length);
    });

    it.each(CONFORMANCE_CASES)("%s", (id, markdown, html) => {
        const rendered = normalize(blockHtml(parseMarkdown(markdown).children));
        if (id in DIFFERENCES) {
            expect(rendered).toBe(normalize(DIFFERENCES[id]));
            expect(rendered).not.toBe(normalize(html));
        } else {
            expect(rendered).toBe(normalize(html));
        }
    });
});
