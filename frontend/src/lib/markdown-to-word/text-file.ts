/**
 * Reading a chosen Markdown file, and the page size a visitor most likely
 * uses. Both run in the browser; nothing is sent anywhere.
 */
import type { PageSize } from "./ooxml";

/** Files larger than this are not opened: the converter takes about ten megabytes of text. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ReadText = { ok: true; text: string } | { ok: false; problem: "binary" | "empty" };

/**
 * A file's bytes as text: UTF-8 (with or without a byte order mark), UTF-16
 * with its byte order mark, or, for older files that aren't valid UTF-8,
 * Windows-1252. A file with NUL bytes in its first 64 KB is not text.
 */
export function decodeText(bytes: Uint8Array): ReadText {
    let text: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
    else {
        const head = bytes.subarray(0, 64 * 1024);
        if (head.includes(0)) return { ok: false, problem: "binary" };
        const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        } catch {
            text = new TextDecoder("windows-1252").decode(body);
        }
    }
    if (text.includes("\0")) return { ok: false, problem: "binary" };
    return text.trim() ? { ok: true, text } : { ok: false, problem: "empty" };
}

/** Letter where it is the usual paper (the United States, Canada, Mexico, the Philippines), A4 elsewhere. */
export function likelyPageSize(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]): PageSize {
    const region = languages.map(tag => /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/.exec(tag ?? "")?.[1]?.toUpperCase()).find(Boolean);
    return region && ["US", "CA", "MX", "PH"].includes(region) ? "letter" : "a4";
}

/** Words for the action bar's count: runs of text with a letter or digit, so Markdown's own marks (#, |, -, ---) don't count. */
export function wordCount(text: string): number {
    let count = 0;
    const words = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = words.exec(text))) if (/[\p{L}\p{N}]/u.test(match[0])) count++;
    return count;
}
