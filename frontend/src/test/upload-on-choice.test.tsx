/**
 * What a tool page sends when its visitor only chooses a file.
 *
 * Every tool page says where the file goes (skins/experience/tool-location.ts),
 * and for a server tool the default words are "Files are uploaded only when
 * you run the tool". Organize Pages and Remove Watermark upload the moment a
 * PDF is chosen, to draw page thumbnails and to look for watermarks, so that
 * sentence was untrue there. This test renders every registry tool's UI as its
 * page mounts it, chooses a synthetic file in every file input it shows (and
 * in any that appear after a choice), runs the clock five seconds on so an
 * upload a moment after the choice counts too, and records what goes over the
 * network: fetch, XMLHttpRequest and sendBeacon, with nothing answering. Only
 * the tools in UPLOADS_WHEN_CHOSEN may send anything, and their location says
 * so. It cannot see a Worker or a WebSocket (jsdom has neither), and files
 * other than PDF and PNG are a few placeholder bytes, so a path that reads the
 * file before uploading may give up first: it catches the common case, not
 * every one.
 */
import { Component, Suspense, type ReactNode } from "react";
import { act, cleanup, configure, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/components/AppProviders";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { ToolUI as PdfToolUI } from "@/pages/ToolPage";
import { ToolUI as NonPdfToolUI } from "@/pages/NonPdfToolPage";
import { UPLOADS_WHEN_CHOSEN, toolLocation } from "@/skins/experience/tool-location";
import { installNetwork, type SentRequest } from "./fake-network";
import { pdfBytes } from "./pdf-pages";

vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []), consumeFileHandoff: vi.fn(async () => null) }));
vi.mock("@/lib/signatureStore", () => ({ loadSignature: vi.fn(async () => null), saveSignature: vi.fn(), forgetSignature: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

// A whole tool UI loads on first use; on a busy machine that can take a while.
configure({ asyncUtilTimeout: 15000 });

/** Tool pages that open on a text or settings form, with no file input until the visitor asks for one. */
const NO_FILE_INPUT = new Set([
    "html-to-pdf", "url-to-pdf", "generate-barcode", "jwt-decoder", "base64", "json-xml-formatter", "hash-generator",
    "text-diff", "csv-json", "yaml-to-json", "json-to-yaml", "url-encoder", "case-converter", "cron-parser",
    "sql-formatter", "graphql-formatter", "yaml-toml-converter", "gitignore-generator", "semver-bumper",
    "env-validator", "json-to-csv-schema", "regex-tester", "timestamp-converter", "password-generator",
    "uuid-generator", "color-converter", "word-counter", "lorem-ipsum",
]);

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const MIME: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", opus: "audio/opus",
    zip: "application/zip", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html", md: "text/markdown",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const KIND_EXTENSION: Record<string, string> = { image: "png", video: "mp4", audio: "mp3", text: "txt" };

/** One synthetic file the input takes: a real one-page PDF, a real 1×1 PNG, or a few bytes of the type. */
function fileFor(accept: string | null): File {
    const first = (accept || ".pdf").split(",").map(part => part.trim().toLowerCase()).find(Boolean) || ".pdf";
    const ext = first.startsWith(".") ? first.slice(1) : first.includes("/") ? KIND_EXTENSION[first.split("/")[0]] || "pdf" : "pdf";
    const bytes = ext === "pdf" ? new Uint8Array(pdfBytes([{ mediabox: [0, 0, 612, 792] }])) : ext === "png" ? PNG : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    return new File([bytes], `sample.${ext}`, { type: MIME[ext] || "application/octet-stream" });
}

/** A tool UI that throws leaves nothing to choose a file in: fail on it rather than skip it. */
class Crash extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: Error) { this.props.onError(error); }
    render() { return this.state.failed ? null : this.props.children; }
}

type Row = { slug: string; name: string; accepts: string; outputLabel: string; pdf: boolean };
const ROWS: Row[] = [
    ...tools.map(tool => ({ slug: tool.slug, name: tool.name, accepts: tool.accepts, outputLabel: tool.outputLabel, pdf: true })),
    ...nonPdfTools.map(tool => ({ slug: tool.slug, name: tool.name, accepts: tool.accepts, outputLabel: tool.outputLabel, pdf: false })),
];

let requests: SentRequest[] = [];
let beacons: string[] = [];
const scrolling = { scrollTo: Element.prototype.scrollTo, scrollIntoView: Element.prototype.scrollIntoView };

beforeAll(() => {
    // jsdom lays nothing out and implements neither.
    Element.prototype.scrollTo = function scrollTo() { /* no layout */ };
    Element.prototype.scrollIntoView = function scrollIntoView() { /* no layout */ };
});
afterAll(() => Object.assign(Element.prototype, scrolling));
beforeEach(() => {
    localStorage.clear();
    ({ requests } = installNetwork({ uploadMs: 0 }));
    beacons = [];
    // jsdom has no sendBeacon; record any use of it as a request.
    Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: (url: string) => { beacons.push(String(url)); return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("what a tool page sends when a file is only chosen", () => {
    it.each(ROWS)("$slug", async row => {
        const UI = row.pdf ? PdfToolUI : NonPdfToolUI;
        const crashes: Error[] = [];
        let container!: HTMLElement;
        await act(async () => {
            ({ container } = render(<MemoryRouter><AppProviders><Crash onError={error => crashes.push(error)}><Suspense fallback={<div data-loading="" />}>
                <UI slug={row.slug} toolName={row.name} outputLabel={row.outputLabel} accepts={row.accepts} />
            </Suspense></Crash></AppProviders></MemoryRouter>));
        });
        await vi.waitFor(() => { if (container.querySelector("[data-loading]")) throw new Error(`${row.slug} is still loading`); }, { timeout: 15000, interval: 20 });
        expect(crashes.map(String)).toEqual([]);
        const input = container.querySelector<HTMLInputElement>("input[type=file]");
        if (NO_FILE_INPUT.has(row.slug)) {
            expect(input, `${row.slug} has a file input now: take it out of NO_FILE_INPUT`).toBeNull();
            return;
        }
        expect(input, `${row.slug} shows no file input to choose from: if it opens on text, add it to NO_FILE_INPUT`).not.toBeNull();
        // Choose in every file input, including any a first choice reveals, and run
        // the clock five seconds on after each round so a delayed upload counts too.
        vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
        try {
            const chosen = new WeakSet<HTMLInputElement>();
            for (let round = 0; round < 3; round++) {
                const fresh = [...container.querySelectorAll<HTMLInputElement>("input[type=file]")].filter(el => !chosen.has(el));
                if (!fresh.length) break;
                for (const el of fresh) {
                    chosen.add(el);
                    if (!el.isConnected) continue;
                    await act(async () => {
                        fireEvent.change(el, { target: { files: [fileFor(el.getAttribute("accept"))] } });
                    });
                }
                await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            }
        } finally {
            vi.useRealTimers();
        }
        expect(crashes.map(String)).toEqual([]);
        const sent = [...requests.map(request => request.url), ...beacons].map(url => url.replace(/^https?:\/\/[^/]+/, ""));
        if (UPLOADS_WHEN_CHOSEN.includes(row.slug)) {
            expect(sent.length, `${row.slug} is listed in UPLOADS_WHEN_CHOSEN but sent nothing`).toBeGreaterThan(0);
            expect(toolLocation(row).detail).toMatch(/uploaded when you choose it/);
        } else {
            expect(sent, `${row.slug} sends a request when a file is only chosen: list it in UPLOADS_WHEN_CHOSEN and say so in toolLocation()`).toEqual([]);
        }
    }, 30000);
});
