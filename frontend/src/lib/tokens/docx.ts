/**
 * The body text of a Word (.docx) file, read without a DOM so that it can run
 * in a token worker (tokens-cl100k.worker.ts). DOMParser exists only on the page's
 * thread, where it held the page still while it parsed: 5 seconds for 16 MB
 * of Word markup in Chromium on the dev VM, and 21 for 63 MB.
 *
 * word/document.xml is read with a namespace-aware scan of its tags, keeping
 * Word's view with tracked changes accepted: paragraphs on lines of their
 * own, tables cell by cell, tabs and line breaks kept, and content saved in
 * two forms for older readers (a text box as a shape and as VML) read once,
 * from its first alternative. Left out: headers, footers, footnotes, endnotes
 * and comments (other parts of the file), deleted and moved-away text, field
 * codes, and formatting, including the tab stops listed in properties.
 */
import { unzipSync } from "fflate";
import { ReadError } from "./errors";

/** word/document.xml unpacked, markup included: markup runs several times the text it carries. */
export const MAX_DOCX_XML_BYTES = 32 * 1024 * 1024;
export const MAX_DOCX_XML_LABEL = "32 MB";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** A comment, a processing instruction, CDATA, a doctype, or a tag, whose quoted attribute values may hold ">". */
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

interface Frame {
    /** The qualified name, which the end tag must repeat. */
    name: string;
    ns: string | undefined;
    local: string;
    /** Namespaces this element declares. */
    scope: Map<string, string> | null;
    /** This element and everything in it are left out. */
    skip: boolean;
    /** A w:t, whose character data is the text. */
    text: boolean;
    /** An mc:AlternateContent: whether one of its alternatives has been read. */
    alternatives: { chosen: boolean } | null;
}

/** XML reads every line break as \n, as DOMParser would. */
const lineEnds = (data: string) => (data.indexOf("\r") < 0 ? data : data.replace(/\r\n?/g, "\n"));

function decode(data: string): string {
    const text = lineEnds(data);
    if (text.indexOf("&") < 0) return text;
    return text.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
        if (name) return NAMED[name];
        const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}

/** The text of word/document.xml, or null when the markup is not well formed. */
export function wordBodyText(xml: string): string | null {
    const out: string[] = [];
    const stack: Frame[] = [];
    const resolve = (prefix: string, own: Map<string, string> | null): string | undefined => {
        if (own?.has(prefix)) return own.get(prefix);
        for (let i = stack.length - 1; i >= 0; i--) {
            const scope = stack[i].scope;
            if (scope?.has(prefix)) return scope.get(prefix);
        }
        return prefix === "xml" ? "http://www.w3.org/XML/1998/namespace" : undefined;
    };
    const close = (frame: Frame) => {
        if (!frame.skip && frame.ns === W_NS && frame.local === "p") out.push("\n");
    };

    let last = 0;
    TOKEN.lastIndex = 0;
    for (let match = TOKEN.exec(xml); match; match = TOKEN.exec(xml)) {
        // A "<" between tags is markup the scan doesn't know: not well formed.
        const stray = xml.indexOf("<", last);
        if (stray >= 0 && stray < match.index) return null;
        const top = stack[stack.length - 1];
        if (top?.text && !top.skip) {
            if (match.index > last) out.push(decode(xml.slice(last, match.index)));
            if (match[1] !== undefined) out.push(lineEnds(match[1]));
        }
        last = TOKEN.lastIndex;
        const name = match[3];
        if (name === undefined) continue; // a comment, an instruction, CDATA or a doctype
        if (match[2] === "/") {
            const frame = stack.pop();
            if (!frame || frame.name !== name) return null;
            close(frame);
            continue;
        }
        const attributes = match[4];
        let scope: Map<string, string> | null = null;
        if (attributes && attributes.includes("xmlns")) {
            ATTRIBUTE.lastIndex = 0;
            for (let attribute = ATTRIBUTE.exec(attributes); attribute; attribute = ATTRIBUTE.exec(attributes)) {
                const [, key, double, single] = attribute;
                if (key === "xmlns" || key.startsWith("xmlns:")) (scope ??= new Map()).set(key === "xmlns" ? "" : key.slice(6), decode(double ?? single ?? ""));
            }
        }
        const colon = name.indexOf(":");
        const local = colon < 0 ? name : name.slice(colon + 1);
        const frame: Frame = { name, ns: resolve(colon < 0 ? "" : name.slice(0, colon), scope), local, scope, skip: top?.skip ?? false, text: false, alternatives: null };
        if (!frame.skip) {
            if (top?.alternatives) {
                // Inside mc:AlternateContent only its first Choice or Fallback is read.
                const alternative = frame.ns === MC_NS && (local === "Choice" || local === "Fallback");
                if (!alternative || top.alternatives.chosen) frame.skip = true;
                else top.alternatives.chosen = true;
            } else if (frame.ns === MC_NS) {
                if (local === "AlternateContent") frame.alternatives = { chosen: false };
                else frame.skip = true;
            } else if (frame.ns === W_NS) {
                // Properties (pPr, rPr, sectPr, tblPr…) hold no text; their w:tab elements are tab stops, not tabs.
                if (local.endsWith("Pr") || local === "delText" || local === "instrText" || local === "moveFrom") frame.skip = true;
                else if (local === "t") frame.text = true;
                else if (local === "tab") out.push("\t");
                else if (local === "br" || local === "cr") out.push("\n");
                else if (local === "noBreakHyphen") out.push("-");
            }
        }
        if (match[5] === "/") close(frame);
        else stack.push(frame);
    }
    if (stack.length || xml.indexOf("<", last) >= 0) return null;
    return out.join("").replace(/\n$/, "");
}

class XmlTooLarge extends Error {}

/** A .docx file's body text; refuses a file that is not a Word document or whose document part unpacks too large. */
export function readDocxText(bytes: Uint8Array, { name = "This file" }: { name?: string } = {}): string {
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
            throw new ReadError("docx-too-large", `${name} is too large to read here: its main document part, markup included, unpacks to more than ${MAX_DOCX_XML_LABEL}. Split it into smaller documents and count each one.`, "too_large");
        }
        throw unreadable();
    }
    if (!xml) throw unreadable();
    const text = wordBodyText(new TextDecoder("utf-8").decode(xml));
    if (text === null) throw unreadable();
    return text;
}
