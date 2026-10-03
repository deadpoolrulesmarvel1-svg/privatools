/**
 * PDF to Markdown's page: the options it sends, and what it says afterwards.
 *
 * The server converts in a bounded worker and answers with the Markdown (or a
 * ZIP of chunks) and an X-Markdown-Report header. The page must send the
 * options as the route's form fields, download the result once, name pages
 * that had no text layer, list the repeated lines it left out, and show a
 * refusal's own words, which are written to pass friendlyError() unchanged.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
    ...(await original<object>()),
    uploadFile: mocks.upload,
    downloadBlob: mocks.download,
}));

import { PdfToMarkdownUI } from "./PdfToMarkdownUI";
import { pageList, reportSummary, type MarkdownReport } from "./pdf-to-markdown-report";

const MARKDOWN = "<!-- page 1 -->\n\n# Quarterly Engineering Notes\n\n| Name | Role |\n| --- | --- |\n| Ada | Analyst |\n";
// The server's words for a scan (pdf_to_markdown_service.SCAN_MESSAGE).
const SCAN = "This PDF's pages are pictures without a text layer, as a scan's are, so there is nothing to convert yet. "
    + "Run the file through OCR PDF first, then convert the result.";

function report(overrides: Partial<MarkdownReport> = {}): MarkdownReport {
    return {
        pages: 2, headings: 6, tables: 1, listItems: 3, codeBlocks: 1, images: 0, links: 1,
        pagesWithoutText: [], pagesWithoutTextCount: 0, pagesNotRead: [], pagesNotReadCount: 0,
        headersFootersRemoved: 0, removedLines: [], chunks: 1, characters: MARKDOWN.length, ...overrides,
    };
}

function answer(facts: MarkdownReport, body = MARKDOWN, name = "report.md"): Response {
    // A string body: jsdom's Blob would reach the Response as "[object Blob]".
    return new Response(body, {
        headers: { "X-Markdown-Report": JSON.stringify(facts), "Content-Disposition": `attachment; filename="${name}"` },
    });
}

function choose(view: ReturnType<typeof render>, names = ["report.pdf"]) {
    const files = names.map(name => new File(["%PDF-1.7"], name, { type: "application/pdf" }));
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files } });
}

async function convert(view: ReturnType<typeof render>) {
    fireEvent.click(screen.getByRole("button", { name: /Convert/ }));
    return screen.findByRole("heading", { level: 2, name: /Markdown|couldn’t be converted|converted/ }, { timeout: 5000 });
}

const show = () => render(<MemoryRouter><PdfToMarkdownUI /></MemoryRouter>);

beforeEach(() => {
    mocks.upload.mockReset();
    mocks.download.mockReset();
    localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => vi.useRealTimers());

describe("PDF to Markdown", () => {
    it("sends the default options and downloads the Markdown once", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report()));
        const view = show();
        choose(view);
        const heading = await convert(view);
        expect(heading).toHaveTextContent("Your Markdown is ready.");
        const [endpoint, file, params] = mocks.upload.mock.calls[0];
        expect(endpoint).toBe("/pdf-to-markdown");
        expect(file.name).toBe("report.pdf");
        expect(params).toEqual({ page_markers: true, remove_headers_footers: true, chunk: "none", chunk_size: 4000, chunk_output: "zip" });
        expect(mocks.download).toHaveBeenCalledTimes(1);
        expect(mocks.download.mock.calls[0][1]).toBe("report.md");
        // The file's row says what was found.
        expect(screen.getByText(/^2 pages · 6 headings · 1 table · 3 list items · 1 code block · 1 link · /)).toBeInTheDocument();
    });

    it("sends chunking and the switches as chosen", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report({ chunks: 5 }), "<!-- chunk 1 of 5 -->\n\n# A\n"));
        const view = show();
        choose(view);
        fireEvent.click(screen.getByRole("checkbox", { name: "Page markers" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Remove repeated headers and footers" }));
        fireEvent.click(screen.getByRole("button", { name: /By size/ }));
        fireEvent.change(screen.getByLabelText("Chunk size"), { target: { value: "8000" } });
        fireEvent.click(screen.getByRole("button", { name: /One \.md file/ }));
        const heading = await convert(view);
        expect(heading).toHaveTextContent("Your Markdown, in 5 chunks.");
        expect(mocks.upload.mock.calls[0][2]).toEqual({
            page_markers: false, remove_headers_footers: false, chunk: "size", chunk_size: 8000, chunk_output: "single",
        });
    });

    it("asks for a ZIP of chunks by heading and shows no preview of a ZIP", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report({ chunks: 3 }), "PK", "report_chunks.zip"));
        const view = show();
        choose(view);
        fireEvent.click(screen.getByRole("button", { name: /By heading/ }));
        await convert(view);
        expect(mocks.upload.mock.calls[0][2]).toMatchObject({ chunk: "headings", chunk_output: "zip" });
        expect(screen.getByText("The ZIP download has started: one .md file per chunk.")).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Markdown preview" })).toBeNull();
        expect(mocks.download.mock.calls[0][1]).toBe("report_chunks.zip");
    });

    it("names pages without a text layer and points to OCR PDF", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report({ pagesWithoutText: [2, 5], pagesWithoutTextCount: 2 })));
        const view = show();
        choose(view);
        await convert(view);
        const notes = screen.getByRole("list", { name: "About this conversion" });
        expect(notes).toHaveTextContent("Pages 2 and 5 have no text layer, as a scan doesn’t, so they are not in the Markdown.");
        expect(within(notes).getByRole("link", { name: "OCR PDF" })).toHaveAttribute("href", "/tool/ocr-pdf");
    });

    it("lists the repeated lines it left out", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report({ headersFootersRemoved: 4, removedLines: ["Northwind Traders", "Page 1 of 4"] })));
        const view = show();
        choose(view);
        await convert(view);
        expect(screen.getByRole("list", { name: "About this conversion" }))
            .toHaveTextContent("Left out as repeated headers or footers on 4 pages: “Northwind Traders”, “Page 1 of 4”.");
    });

    it("shows the Markdown as text and copies it", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report()));
        const view = show();
        choose(view);
        await convert(view);
        const preview = await screen.findByRole("region", { name: "Markdown preview" });
        // Plain text: the table's pipes are shown, not rendered.
        expect(within(preview).getByLabelText("The Markdown").textContent).toBe(MARKDOWN);
        fireEvent.click(within(preview).getByRole("button", { name: /Copy Markdown/ }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MARKDOWN);
        expect(await within(preview).findByRole("button", { name: /Copied/ })).toBeInTheDocument();
    });

    it("shows a refused scan's own reason, offers another file and no retry", async () => {
        mocks.upload.mockRejectedValueOnce(Object.assign(new Error(SCAN), { __status: 422, __detail: SCAN }));
        const view = show();
        choose(view);
        const heading = await convert(view);
        expect(heading).toHaveTextContent("This PDF couldn’t be converted.");
        expect(screen.getByText(SCAN)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
        expect(mocks.download).not.toHaveBeenCalled();
    });

    it("converts several PDFs and downloads them in one ZIP", async () => {
        mocks.upload.mockResolvedValueOnce(answer(report(), MARKDOWN, "a.md")).mockResolvedValueOnce(answer(report(), MARKDOWN, "b.md"));
        const view = show();
        choose(view, ["a.pdf", "b.pdf"]);
        expect(screen.getByRole("button", { name: /Convert 2 PDFs/ })).toBeInTheDocument();
        const heading = await convert(view);
        expect(heading).toHaveTextContent("2 PDFs converted to Markdown.");
        expect(mocks.upload).toHaveBeenCalledTimes(2);
        expect(mocks.download).toHaveBeenCalledTimes(1);
        expect(mocks.download.mock.calls[0][1]).toBe("markdown.zip");
    });
});

describe("the report's words", () => {
    it("lists pages as a sentence, with the rest counted", () => {
        expect(pageList([4])).toBe("4");
        expect(pageList([4, 7])).toBe("4 and 7");
        expect(pageList([4, 7, 9])).toBe("4, 7 and 9");
        expect(pageList([1, 2, 3], 45)).toBe("1, 2, 3 and 42 more");
    });

    it("summarises only what was found", () => {
        expect(reportSummary(report({ headings: 0, tables: 0, listItems: 0, codeBlocks: 0, links: 0, pages: 1 }), 2048))
            .toBe("1 page · 2.0 KB");
        expect(reportSummary(null, 512)).toBe("512 B");
    });
});
