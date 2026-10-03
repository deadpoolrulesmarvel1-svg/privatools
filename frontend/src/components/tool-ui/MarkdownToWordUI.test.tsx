/**
 * Markdown to Word's page: paste or open, convert, one download, and the
 * outcomes the shared kit's grammar asks for. Everything runs in this
 * browser, so no test here may see a request, even for an image address.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { TOOL_RUN_EVENT, type ToolRunDetail } from "@/lib/toolRun";
import { installNetwork, type SentRequest } from "@/test/fake-network";
import { MarkdownToWordUI } from "./MarkdownToWordUI";

const downloads = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock("@/lib/api", async original => ({
    ...(await original<typeof import("@/lib/api")>()),
    downloadBlob: vi.fn((blob: Blob, name: string) => { downloads.push({ blob, name }); }),
}));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }) }));

let requests: SentRequest[] = [];
let runs: ToolRunDetail[] = [];
const onRun = (event: Event) => runs.push((event as CustomEvent<ToolRunDetail>).detail);

beforeEach(() => {
    localStorage.clear();
    downloads.length = 0;
    runs = [];
    ({ requests } = installNetwork({ uploadMs: 0 }));
    window.addEventListener(TOOL_RUN_EVENT, onRun);
});
afterEach(() => {
    window.removeEventListener(TOOL_RUN_EVENT, onRun);
    cleanup();
    vi.unstubAllGlobals();
});

const box = () => screen.getByRole("textbox", { name: "Paste Markdown" }) as HTMLTextAreaElement;
const convertButton = () => screen.getByRole("button", { name: /Convert to Word/ });
const fileInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>("input[type=file]")!;

async function paste(text: string) {
    await act(async () => { fireEvent.change(box(), { target: { value: text } }); });
}

async function convert() {
    await act(async () => { fireEvent.click(convertButton()); });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 10000 });
}

async function documentXml(blob: Blob): Promise<string> {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    return new TextDecoder().decode(files["word/document.xml"]);
}

describe("Markdown to Word page", () => {
    it("waits for Markdown before it converts", () => {
        render(<MarkdownToWordUI />);
        expect(convertButton()).toBeDisabled();
        expect(screen.getByText("Paste Markdown or open a file to convert it.")).toBeInTheDocument();
        fireEvent.change(box(), { target: { value: "   \n  " } });
        expect(convertButton()).toBeDisabled();
    });

    it("converts pasted Markdown, downloads it once, and offers it again", async () => {
        render(<MarkdownToWordUI />);
        await paste("# Weekly notes\n\nSome **bold** text and $E = mc^2$.\n\n| a | b |\n|---|---|\n| 1 | 2 |");
        expect(screen.getByText("12 words")).toBeInTheDocument();
        await convert();
        const heading = await screen.findByRole("heading", { name: "Your Word document is ready." });
        expect(heading).toHaveFocus();
        expect(screen.getByText("The download has started.")).toBeInTheDocument();
        expect(downloads).toHaveLength(1);
        expect(downloads[0].name).toBe("Weekly notes.docx");
        expect(downloads[0].blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        const xml = await documentXml(downloads[0].blob);
        expect(xml).toContain("<w:pStyle w:val=\"Heading1\"/>");
        expect(xml).toContain("<m:oMath>");
        expect(xml).toContain("<w:tblStyle w:val=\"TableGrid\"/>");
        expect(runs).toEqual([{ outcome: "success", files: 1 }]);
        fireEvent.click(screen.getByRole("button", { name: "Download again" }));
        expect(downloads).toHaveLength(2);
        expect(requests).toEqual([]);
    });

    it("says which equations stayed LaTeX and which images were left out, and never fetches an image", async () => {
        render(<MarkdownToWordUI />);
        await paste("Fine: $x^2$.\n\nNot mapped: $\\notamacro{x}$\n\n![A chart](https://example.com/charts/sales.png)\n\n<img src=\"https://example.com/b.gif\" alt=\"B\">");
        await convert();
        expect(await screen.findByRole("heading", { name: "Your Word document is ready, with 1 equation left as LaTeX and 2 images left out." })).toHaveFocus();
        expect(screen.getByText("$\\notamacro{x}$")).toBeInTheDocument();
        expect(screen.getByText("Line 3: \\notamacro isn’t supported.")).toBeInTheDocument();
        expect(screen.getByText("sales.png")).toBeInTheDocument();
        expect(screen.getAllByText("Line 5: it is at a web address, and images are never downloaded.")).toHaveLength(1);
        expect(screen.getByText("b.gif")).toBeInTheDocument();
        expect(runs).toEqual([{ outcome: "partial", files: 1, errorKind: "bad_input" }]);
        expect(downloads).toHaveLength(1);
        const xml = await documentXml(downloads[0].blob);
        expect(xml).toContain("[Image: A chart]");
        expect(requests).toEqual([]);
    });

    it("opens a chosen file into the box, names the document after it, and keeps the text when you go back", async () => {
        const { container } = render(<MarkdownToWordUI />);
        const file = new File(["# From a file\n\n- one\n- two\n"], "meeting-notes.md", { type: "text/markdown" });
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [file] } }); });
        await waitFor(() => expect(box().value).toBe("# From a file\n\n- one\n- two\n"));
        expect(screen.getByText("From meeting-notes.md")).toBeInTheDocument();
        await convert();
        expect(downloads.map(item => item.name)).toEqual(["meeting-notes.docx"]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit the Markdown" })); });
        expect(box().value).toBe("# From a file\n\n- one\n- two\n");
        expect(box()).toHaveFocus();
        await act(async () => { fireEvent.click(convertButton()); });
        await screen.findByRole("heading", { name: "Your Word document is ready." });
        // A second run downloads once too.
        expect(downloads).toHaveLength(2);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Convert other Markdown" })); });
        expect(box().value).toBe("");
        expect(requests).toEqual([]);
    });

    it("refuses an empty file, a binary file and one over 10 MB, by name, and keeps the text", async () => {
        const { container } = render(<MarkdownToWordUI />);
        await paste("Keep me");
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File([""], "empty.md")] } }); });
        expect(await screen.findByRole("alert")).toHaveTextContent("empty.md is empty. It holds no text to convert.");
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13])], "image.md")] } }); });
        expect(await screen.findByRole("alert")).toHaveTextContent("image.md isn’t a text file. Markdown to Word reads .md, .markdown and .txt files saved as plain text.");
        const big = new File(["x"], "huge.md");
        Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [big] } }); });
        expect(await screen.findByRole("alert")).toHaveTextContent("huge.md wasn’t opened. It is 11.0 MB; this tool converts Markdown up to 10 MB.");
        expect(box().value).toBe("Keep me");
        expect(runs).toEqual([]);
    });

    it("refuses a file of another type beside the intake, saying what it takes and which tool does the job", async () => {
        // On its own page, so the advice can name the tool, as it does in the app.
        window.history.pushState({}, "", "/tools/markdown-to-word");
        try {
            const { container } = render(<MarkdownToWordUI />);
            await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" })] } }); });
            expect(screen.getByRole("alert")).toHaveTextContent("report.pdf wasn’t added. Markdown to Word takes MD or TXT files. Try PDF to Word for PDF files.");
            await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File(["x"], "draft.docx")] } }); });
            expect(screen.getByRole("alert")).toHaveTextContent("draft.docx wasn’t added. Markdown to Word takes MD or TXT files. It’s already a DOCX.");
            expect(box().value).toBe("");
        } finally {
            window.history.pushState({}, "", "/");
        }
    });

    it("reads UTF-16 and older single-byte files as text", async () => {
        const { container } = render(<MarkdownToWordUI />);
        const utf16 = new Uint8Array([0xff, 0xfe, ...[..."# Été"].flatMap(c => [c.charCodeAt(0), 0])]);
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File([utf16], "utf16.md")] } }); });
        await waitFor(() => expect(box().value).toBe("# Été"));
        const latin1 = new Uint8Array([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9]);
        await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File([latin1], "old.txt")] } }); });
        await waitFor(() => expect(box().value).toBe("# Café"));
    });

    it("fails a run over the size limit honestly, with no download and no retry", async () => {
        render(<MarkdownToWordUI />);
        await paste("x".repeat(10 * 1024 * 1024 + 1));
        await convert();
        expect(await screen.findByRole("heading", { name: "This Markdown is too long to convert." })).toHaveFocus();
        expect(screen.getByText(/^Nothing was created\./)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
        expect(downloads).toEqual([]);
        expect(runs).toEqual([{ outcome: "error", files: 1, errorKind: "too_large" }]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back to the Markdown" })); });
        expect(box().value.length).toBe(10 * 1024 * 1024 + 1);
    }, 30000);

    it("sets the page size it is told, and remembers it", async () => {
        render(<MarkdownToWordUI />);
        const a4 = screen.getByRole("button", { name: /^A4/ });
        await act(async () => { fireEvent.click(a4); });
        expect(a4).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /^Letter/ })).toHaveAttribute("aria-pressed", "false");
        await paste("# Page");
        await convert();
        expect(await documentXml(downloads[0].blob)).toContain("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>");
        // Settings are written a moment after they change.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
        cleanup();
        render(<MarkdownToWordUI />);
        expect(screen.getByRole("button", { name: /^A4/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("converts with Ctrl+Enter, and fills the box with a sample to try", async () => {
        render(<MarkdownToWordUI />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try a sample" })); });
        expect(box().value).toContain("$$");
        await act(async () => { fireEvent.keyDown(window, { key: "Enter", ctrlKey: true }); });
        await screen.findByRole("heading", { name: "Your Word document is ready." }, { timeout: 10000 });
        expect(downloads.map(item => item.name)).toEqual(["Projectile motion.docx"]);
    });
});
