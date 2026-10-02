/**
 * The shared failure grammar on every tool that ends in StudioResult: a file
 * the server refused leads with a different file and offers no "Try again"; a
 * failure another attempt could fix (503) offers it, and the retry sends only
 * the files that could pass. The API is stubbed per file name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { uploadFile, uploadFileWithProgress } from "@/lib/api";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { GenericUI } from "./GenericUI";
import { SimpleConvertUI } from "./SimpleConvertUI";
import { SimpleProcessUI } from "./SimpleProcessUI";
import { RotateUI } from "./RotateUI";
import { PdfPageSelectionUI } from "./pdf/PdfPageSelectionUI";
import { PdfToWordUI } from "./PdfToWordUI";
import { OcrUI } from "./OcrUI";

vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(), uploadFile: vi.fn(), uploadFileWithProgress: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));
vi.mock("./pdf/PdfPageStage", () => ({
    PdfPageStage: ({ onDimensions }: { onDimensions?: (info: { pages: number }) => void }) => {
        useEffect(() => { onDimensions?.({ pages: 3 }); }, [onDimensions]);
        return <div data-testid="stage" />;
    },
}));

const pdf = (name: string) => new File(["%PDF synthetic"], name, { type: "application/pdf" });
const ok = () => ({ blob: async () => new Blob(["out"], { type: "application/pdf" }), headers: new Headers() }) as Response;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { __status: status, __detail: message });

/** What the server answers for each file name, changed between runs. */
const answers = new Map<string, () => Promise<Response>>();
const answer = async (name: string) => (answers.get(name) ?? (async () => ok()))();
const sentNames = () => [...vi.mocked(uploadFile).mock.calls, ...vi.mocked(uploadFileWithProgress).mock.calls].map(call => (call[1] as File).name);

beforeEach(() => {
    vi.clearAllMocks();
    answers.clear();
    vi.mocked(consumeFileHandoffs).mockResolvedValue([]);
    vi.mocked(uploadFile).mockImplementation(async (_endpoint, file) => answer((file as File).name));
    vi.mocked(uploadFileWithProgress).mockImplementation(async (_endpoint, file) => answer((file as File).name));
    URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); localStorage.clear(); });

interface Surface {
    name: string;
    ui: () => ReactElement;
    run: () => void;
    one: string; several: string; partial: string;
}

const surfaces: Surface[] = [
    {
        name: "GenericUI", ui: () => <GenericUI slug="rotate-pdf" toolName="Rotate PDF" actionLabel="Rotate now" outputLabel="rotated.pdf" accepts=".pdf" />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /^Rotate now/ })),
        one: "This file couldn’t be processed.", several: "None of these files could be processed.", partial: "1 of 2 files ready.",
    },
    {
        name: "SimpleConvertUI", ui: () => <SimpleConvertUI slug="flatten-pdf" label="Flatten PDF" outputExt="pdf" outputFilename="flattened.pdf" acceptFileTypes=".pdf" description="Flatten PDFs" />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /Flatten PDF/ })),
        one: "This file couldn’t be processed.", several: "None of these files could be processed.", partial: "1 of 2 files ready.",
    },
    {
        name: "SimpleProcessUI", ui: () => <SimpleProcessUI endpoint="/repair-pdf" accepts=".pdf" outputSuffix="repaired" outputExt="pdf" dropTitle="Bring a damaged PDF." dropSubtitle="PDFs only"
            actionLabel="Repair PDFs" processingLabel="Repairing" doneTitle="Repaired" />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /Repair PDFs/ })),
        one: "This file couldn’t be processed.", several: "None of these files could be processed.", partial: "Repaired for 1 of 2 files.",
    },
    {
        name: "RotateUI", ui: () => <RotateUI />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /^Rotate (PDF|2 PDFs)/ })),
        one: "This PDF couldn’t be rotated.", several: "None of these PDFs could be rotated.", partial: "1 of 2 PDFs rotated.",
    },
    {
        name: "PdfPageSelectionUI", ui: () => <PdfPageSelectionUI operation="delete" />,
        run: () => {
            fireEvent.change(screen.getByLabelText("Page range"), { target: { value: "1" } });
            fireEvent.click(screen.getByRole("button", { name: "Delete pages" }));
        },
        one: "The pages couldn’t be removed.", several: "The pages couldn’t be removed.", partial: "Done for 1 of 2 PDFs.",
    },
    // Two older screens that once said "Converted" and "OCR complete" over a failure (review of #312).
    {
        name: "PdfToWordUI", ui: () => <PdfToWordUI />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /^Convert (to Word|2 PDFs)/ })),
        one: "This PDF couldn’t be converted.", several: "None of these PDFs could be converted.", partial: "1 of 2 PDFs converted.",
    },
    {
        name: "OcrUI", ui: () => <OcrUI />,
        run: () => fireEvent.click(screen.getByRole("button", { name: /^Run OCR/ })),
        one: "This PDF couldn’t be read.", several: "None of these PDFs could be read.", partial: "1 of 2 PDFs read.",
    },
];

describe("the shared intakes' names", () => {
    it("say the visible action once, then which files (WCAG 2.5.3)", () => {
        render(<GenericUI slug="webp-to-jpg" toolName="WebP to JPG" actionLabel="Convert" outputLabel="image.jpg" accepts=".webp" />);
        expect(screen.getByRole("button", { name: "Choose files: Your WEBP files" })).toBeInTheDocument();
        cleanup();
        render(<SimpleConvertUI slug="flatten-pdf" label="Flatten PDF" outputExt="pdf" outputFilename="flattened.pdf" acceptFileTypes=".pdf" description="Flatten PDFs" />);
        expect(screen.getByRole("button", { name: "Choose files: Your PDF files" })).toBeInTheDocument();
    });
});

function choose(container: HTMLElement, files: File[]) {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
}

describe.each(surfaces)("$name failure result", surface => {
    it("leads a refused file with a different file, says nothing was created, and offers no retry", async () => {
        answers.set("fake.pdf", async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        const { container } = render(surface.ui());
        choose(container, [pdf("fake.pdf")]);
        surface.run();
        const heading = await screen.findByRole("heading", { level: 2, name: surface.one });
        expect(heading).toHaveFocus();
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(screen.queryByText("Ready for what’s next")).toBeNull();
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent(/^Nothing was created\./);
        expect(container.querySelector(".ts-file[data-status=error]")).toHaveTextContent("This doesn’t look like a valid PDF.");
        expect(screen.getByRole("button", { name: /^Choose a different (file|PDF)$/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Try( \d+)? again$/ })).toBeNull();
    });

    it("offers \"Try again\" for a passing failure and sends only that file again", async () => {
        answers.set("fake.pdf", async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        answers.set("busy.pdf", async () => { throw httpError(503, "The server is busy. Please try again."); });
        const { container } = render(surface.ui());
        choose(container, [pdf("fake.pdf"), pdf("busy.pdf")]);
        surface.run();
        await screen.findByRole("heading", { level: 2, name: surface.several });
        expect(sentNames().sort()).toEqual(["busy.pdf", "fake.pdf"]);
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent("trying again may work for one of the files");

        answers.set("busy.pdf", async () => ok());
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await screen.findByRole("heading", { level: 2, name: surface.partial });
        // The refused file is never sent twice.
        expect(sentNames()).toEqual(expect.arrayContaining(["busy.pdf", "fake.pdf"]));
        expect(sentNames().filter(name => name === "fake.pdf")).toHaveLength(1);
        expect(sentNames().filter(name => name === "busy.pdf")).toHaveLength(2);
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "partial");
        expect(container.querySelector(".ts-result-badge")).not.toBeNull();
    });
});
