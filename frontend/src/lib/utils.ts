import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validate a page-range expression like "1,3-5,9" / "1-3, 5, 7-end" / "-4" / "9-".
 * Whitespace and trailing commas are tolerated.
 * Returns true for empty string (caller can decide whether to require non-empty).
 *
 * Rejects:
 *   - "0"                 → page numbers are 1-indexed everywhere
 *   - "-1"                → negative numbers
 *   - "1,2,abc"           → non-numeric token mixed in
 *   - "3-1"               → range with start > end
 *   - whitespace-only "  "
 */
export function isValidPageRange(input: string): boolean {
    const s = input.trim();
    if (!s) return true;
    if (s.toLowerCase() === "all") return true;
    const tokens = s.split(",").map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return false;

    for (const t of tokens) {
        // Disallow stray "-" tokens
        if (t === "-") return false;
        // Negative single number (e.g. "-1") — split() returns ["", "1"] for that.
        if (t.includes("-")) {
            const parts = t.split("-");
            if (parts.length !== 2) return false;
            const [aRaw, bRaw] = parts;
            const a = aRaw.trim();
            const b = bRaw.trim().toLowerCase();
            // "-" alone already filtered above. Both empty would be "-" already.
            // Allow:  "5-end", "5-", "-5", "5-10"
            if (a !== "" && !/^\d+$/.test(a)) return false;
            if (b !== "" && b !== "end" && !/^\d+$/.test(b)) return false;
            // Numeric tokens cannot be "0"
            if (a === "0") return false;
            if (/^\d+$/.test(b) && b === "0") return false;
            // If both are numeric, ensure start ≤ end (catches "5-2")
            if (a !== "" && /^\d+$/.test(b)) {
                if (parseInt(a, 10) > parseInt(b, 10)) return false;
            }
        } else {
            if (!/^\d+$/.test(t)) return false;
            if (t === "0") return false;
        }
    }
    return true;
}

/**
 * Human-readable error for a failed range. Returns null if valid.
 * Returns a specific hint when we can detect the failure mode, otherwise
 * the generic-format example.
 */
export function pageRangeError(input: string): string | null {
    if (isValidPageRange(input)) return null;
    const s = input.trim();
    if (!s) return null;
    if (/\b0\b/.test(s)) return "Page numbers start at 1 — there is no page 0.";
    if (/-\d/.test(s) && /^-/.test(s.split(",")[0]?.trim() || "")) {
        return "Negative page numbers aren't allowed. Use a range like 1-3 instead.";
    }
    // start > end detection
    const tokens = s.split(",").map(t => t.trim());
    for (const t of tokens) {
        const m = t.match(/^(\d+)-(\d+)$/);
        if (m && parseInt(m[1], 10) > parseInt(m[2], 10)) {
            return `Range ${m[1]}-${m[2]} is backwards. Did you mean ${m[2]}-${m[1]}?`;
        }
    }
    if (/[^\d,\-\s]/i.test(s) && !/\bend\b/i.test(s) && !/\ball\b/i.test(s)) {
        return "Only numbers, commas, and dashes allowed (or the keyword 'end').";
    }
    return 'Use formats like "1", "1,3", "1-3,5,7-9", "5-end".';
}

/** Map common backend error strings to friendly messages.
 *
 *  When adding a new mapping, prefer keys that match the LOWERCASED substring
 *  of what the backend actually returns (see app/main.py and individual route
 *  files). The fallback returns the raw message untouched. */
export function friendlyError(raw: string | undefined | null, fallback = "Something went wrong"): string {
    const m = (raw || "").toLowerCase();
    if (!m) return fallback;

    // ── Security / Access ───────────────────────────────────────────────────
    if (m.includes("encrypt") || m.includes("password") || m.includes("protected")) {
        return "This PDF is password-protected. Unlock it first, then try again.";
    }
    if (m.includes("permission") && (m.includes("denied") || m.includes("not allowed"))) {
        return "Permission denied. This PDF blocks the operation — try removing restrictions first.";
    }

    // ── File integrity ──────────────────────────────────────────────────────
    if (m.includes("not a pdf") || m.includes("invalid pdf") || m.includes("could not open") || m.includes("not a valid pdf")) {
        return "That file doesn't look like a valid PDF. Try a different file.";
    }
    if (m.includes("corrupt") || m.includes("damaged") || m.includes("malformed")) {
        return "This PDF is damaged. Try the Repair PDF tool first, then come back.";
    }
    if (m.includes("not an image") || m.includes("invalid image") || m.includes("cannot identify image")) {
        return "That file doesn't look like a valid image.";
    }
    if (m.includes("empty") && (m.includes("file") || m.includes("pdf"))) {
        return "That file is empty (0 bytes). Pick a different file.";
    }
    if (m.includes("no pages") || m.includes("zero pages")) {
        return "This PDF has no pages. Pick a different file.";
    }

    // ── Page / range errors ─────────────────────────────────────────────────
    if (m.includes("page out of range") || m.includes("invalid page") || m.includes("page number")) {
        return "One of the page numbers is outside this PDF. Check the page count and try again.";
    }
    if (m.includes("page range") && (m.includes("invalid") || m.includes("malformed"))) {
        return "That page range isn't valid. Use formats like \"1-3, 5, 7-end\".";
    }

    // ── Network / transport ─────────────────────────────────────────────────
    if (m.includes("network") || m.includes("failed to fetch") || m.includes("ecconnreset") || m.includes("aborted") || m.includes("connection")) {
        return "Couldn't reach the server. Check your connection and try again.";
    }
    if (m.includes("cors")) {
        return "Browser blocked the request (CORS). Try refreshing the page.";
    }

    // ── Size / quota ────────────────────────────────────────────────────────
    if (m.includes("413") || m.includes("too large") || m.includes("payload") || m.includes("entity too large")) {
        return "File is too big for the server. Try compressing it first.";
    }
    if (m.includes("disk") && (m.includes("full") || m.includes("space"))) {
        return "Server is running low on disk space. Try again in a minute.";
    }
    if (m.includes("memory") || m.includes("oom") || m.includes("killed")) {
        return "File needed too much memory. Try a smaller file or lighter settings.";
    }

    // ── Timing ──────────────────────────────────────────────────────────────
    if (m.includes("timeout") || m.includes("timed out") || m.includes("504")) {
        return "The server took too long. Try a smaller file or try again.";
    }
    if (m.includes("rate limit") || m.includes("too many request") || m.includes("429")) {
        return "Slow down — we're rate-limiting requests. Wait a moment and try again.";
    }

    // ── Tool-specific ───────────────────────────────────────────────────────
    if (m.includes("font") && (m.includes("not found") || m.includes("missing"))) {
        return "Font required by this PDF isn't installed on the server. Try flattening the PDF first.";
    }
    if (m.includes("ocr") && (m.includes("failed") || m.includes("error") || m.includes("no text"))) {
        return "OCR couldn't read this PDF. Try a higher-resolution scan or different language.";
    }
    if (m.includes("ghostscript") || m.includes("libreoffice") || m.includes("ffmpeg")) {
        return "A processing tool failed on this file. Try a different file or simpler settings.";
    }
    if (m.includes("unsupported") && m.includes("format")) {
        return "That format isn't supported by this tool. See the accepted file types above.";
    }

    return raw || fallback;
}
