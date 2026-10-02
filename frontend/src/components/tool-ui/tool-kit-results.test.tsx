/**
 * Every tool screen moved onto the shared kit in step 2b ends a run the same
 * way: a file the server refused gets the failure tone, no receipt, focus on
 * the heading and "Choose a different file" first, with no retry; a failure
 * another attempt could fix (503) offers "Try again", which sends only that
 * file; a partial run says both parts. And the download policy: a finished
 * run downloads once by itself (one file, or one ZIP for several), never
 * twice, and the result offers "Download again". The API is stubbed per file
 * name, as in failure-results.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { downloadBlob, uploadFile, uploadFiles, uploadFileWithProgress } from "@/lib/api";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BatesRemoveUI } from "./BatesRemoveUI";
import { BatesUI } from "./BatesUI";
import { CropUI } from "./CropUI";
import { HeaderFooterUI } from "./HeaderFooterUI";
import { HighlightUI } from "./HighlightUI";
import { InvertColorsUI } from "./InvertColorsUI";
import { MetadataUI } from "./MetadataUI";
import { NupUI } from "./NupUI";
import { PageNumbersUI } from "./PageNumbersUI";
import { PdfToExcelUI } from "./PdfToExcelUI";
import { PdfToImageUI } from "./PdfToImageUI";
import { PdfToPptxUI } from "./PdfToPptxUI";
import { PdfToTextUI } from "./PdfToTextUI";
import { PdfToWordUI } from "./PdfToWordUI";
import { PermissionsUI } from "./PermissionsUI";
import { ProtectUI } from "./ProtectUI";
import { RemoveBlankPagesUI } from "./RemoveBlankPagesUI";
import { ResizeUI } from "./ResizeUI";
import { SplitByBookmarksUI } from "./SplitByBookmarksUI";
import { SplitBySizeUI } from "./SplitBySizeUI";
import { StampUI } from "./StampUI";
import { StripMetadataUI } from "./StripMetadataUI";
import { SubtitleConverterUI } from "./SubtitleConverterUI";
import { TransparentBackgroundUI } from "./TransparentBackgroundUI";
import { WatermarkUI } from "./WatermarkUI";
import { GenericUI } from "./GenericUI";
import { SimpleConvertUI } from "./SimpleConvertUI";

vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(), uploadFile: vi.fn(), uploadFiles: vi.fn(), uploadFileWithProgress: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn(), success: vi.fn() }) }));
vi.mock("./pdf/PdfPageStage", () => ({
    // The page opens once: Crop passes a new onDimensions on every render.
    PdfPageStage: ({ onDimensions }: { onDimensions?: (info: { pages: number; width: number; height: number }) => void }) => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        useEffect(() => { onDimensions?.({ pages: 3, width: 612, height: 792 }); }, []);
        return <div data-testid="stage" />;
    },
}));
vi.mock("./pdf/PdfWatermarkPreview", () => ({ PdfWatermarkPreview: () => null }));
vi.mock("@/components/AssetPicker", () => ({ AssetPicker: () => null }));
vi.mock("@/components/VaultPasswordPicker", () => ({ VaultPasswordPicker: () => null }));
vi.mock("@/components/BatesCounterPicker", () => ({ BatesCounterPicker: () => null }));

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
    /** Anything the tool needs before it can run, then the click on its run button. */
    run: () => void;
    /** Past participle in the shared headings: "This PDF couldn’t be <verb>." */
    verb: string;
    /** Several files go one request per file (Bates numbers a set as one request instead). */
    perFile?: boolean;
    /** One file's result is shown on the page to read first, and downloads only on request. */
    review?: string;
}

const click = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const surfaces: Surface[] = [
    { name: "Remove Bates Numbers", ui: () => <BatesRemoveUI />, run: () => click(/^Remove Bates numbers/), verb: "processed" },
    { name: "Bates Numbering", ui: () => <TooltipProvider><BatesUI /></TooltipProvider>, run: () => click(/^Stamp (PDF|\d+ PDFs)/), verb: "numbered", perFile: false },
    { name: "Crop PDF", ui: () => <CropUI />, run: () => click(/^Crop (PDF|\d+ PDFs)/), verb: "cropped" },
    { name: "Header & Footer", ui: () => <HeaderFooterUI />, run: () => { type("Header", "Report"); click(/^Apply to (PDF|\d+ PDFs)/); }, verb: "stamped" },
    { name: "Highlight PDF", ui: () => <HighlightUI />, run: () => { type("Text to highlight", "invoice"); click(/^Highlight (every match|\d+ PDFs)/); }, verb: "highlighted" },
    { name: "Invert Colors", ui: () => <InvertColorsUI />, run: () => click(/^Invert colors/), verb: "inverted" },
    { name: "Metadata", ui: () => <MetadataUI />, run: () => { click(/^Edit$/); click(/^Update metadata/); }, verb: "updated" },
    { name: "N-up", ui: () => <NupUI />, run: () => click(/^Create 2-up layout/), verb: "laid out" },
    { name: "Page Numbers", ui: () => <PageNumbersUI />, run: () => click(/^Number (PDF|\d+ PDFs)/), verb: "numbered" },
    { name: "PDF to Excel", ui: () => <PdfToExcelUI />, run: () => click(/^Convert (to Excel|\d+ PDFs)/), verb: "converted" },
    { name: "PDF to Image", ui: () => <PdfToImageUI />, run: () => click(/^Convert (to JPEG|\d+ PDFs)/), verb: "converted" },
    { name: "PDF to PowerPoint", ui: () => <PdfToPptxUI />, run: () => click(/^Convert (to PowerPoint|\d+ PDFs)/), verb: "converted" },
    { name: "PDF to Text", ui: () => <PdfToTextUI />, run: () => click(/^Extract text/), verb: "extracted", review: "Download .txt" },
    { name: "PDF to Word", ui: () => <PdfToWordUI />, run: () => click(/^Convert (to Word|\d+ PDFs)/), verb: "converted" },
    { name: "Permissions", ui: () => <PermissionsUI />, run: () => click(/^Set permissions/), verb: "updated" },
    { name: "Protect PDF", ui: () => <ProtectUI />, run: () => { type("Password", "correct-horse-battery"); click(/^Protect (PDF|\d+ PDFs)/); }, verb: "protected" },
    { name: "Remove Blank Pages", ui: () => <RemoveBlankPagesUI />, run: () => click(/^Remove blank pages/), verb: "cleaned" },
    { name: "Resize PDF", ui: () => <ResizeUI />, run: () => click(/^Resize (PDF|\d+ PDFs)/), verb: "resized" },
    { name: "Split by Bookmarks", ui: () => <SplitByBookmarksUI />, run: () => click(/^Split by bookmarks/), verb: "split" },
    { name: "Split by Size", ui: () => <SplitBySizeUI />, run: () => click(/^Split by size/), verb: "split" },
    { name: "Stamp PDF", ui: () => <StampUI />, run: () => click(/^Apply stamp/), verb: "stamped" },
    { name: "Strip Metadata", ui: () => <StripMetadataUI />, run: () => click(/^Strip (PDF|\d+ PDFs)/), verb: "stripped" },
    { name: "Transparent Background", ui: () => <TransparentBackgroundUI />, run: () => click(/^Remove background/), verb: "made transparent" },
    { name: "Watermark PDF", ui: () => <WatermarkUI />, run: () => click(/^Watermark (PDF|\d+ PDFs)/), verb: "watermarked" },
];

function choose(container: HTMLElement, files: File[]) {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
}

describe.each(surfaces)("$name on the shared kit", surface => {
    it("leads a refused file with a different file: the failure tone, no receipt, focus on the heading, no retry", async () => {
        answers.set("fake.pdf", async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        const { container } = render(surface.ui());
        choose(container, [pdf("fake.pdf")]);
        surface.run();
        const heading = await screen.findByRole("heading", { level: 2, name: `This PDF couldn’t be ${surface.verb}.` });
        expect(heading).toHaveFocus();
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(screen.queryByText("Ready for what’s next")).toBeNull();
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent(/^Nothing was created\./);
        expect(container.querySelector(".ts-receipt, .ts-compression-receipt")).toBeNull();
        expect(container.querySelector(".ts-file[data-status=error]")).toHaveTextContent("This doesn’t look like a valid PDF.");
        const actions = [...container.querySelectorAll(".ts-actions button")].map(button => button.textContent?.trim());
        expect(actions[0]).toBe("Choose a different file");
        expect(screen.queryByRole("button", { name: /^Try( \d+)? again$/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it("offers \"Try again\" for a failure another attempt could fix, and sends only that file again", async () => {
        if (surface.perFile === false) return; // a set numbered as one request: see the Bates test below
        answers.set("fake.pdf", async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        answers.set("busy.pdf", async () => { throw httpError(503, "The server is busy. Please try again."); });
        const { container } = render(surface.ui());
        choose(container, [pdf("fake.pdf"), pdf("busy.pdf")]);
        surface.run();
        await screen.findByRole("heading", { level: 2, name: `None of these PDFs could be ${surface.verb}.` });
        expect(sentNames().sort()).toEqual(["busy.pdf", "fake.pdf"]);
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent("trying again may work for one of the files");

        answers.set("busy.pdf", async () => ok());
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await screen.findByRole("heading", { level: 2, name: `1 of 2 PDFs ${surface.verb}.` });
        // The refused file is never sent twice.
        expect(sentNames().filter(name => name === "fake.pdf")).toHaveLength(1);
        expect(sentNames().filter(name => name === "busy.pdf")).toHaveLength(2);
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "partial");
        expect(container.querySelector(".ts-result-badge")).not.toBeNull();
        expect(container.querySelector(".ts-file[data-status=error]")).toHaveTextContent("This doesn’t look like a valid PDF.");
        // The run that passed downloads its one result, once.
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
        expect(screen.getByRole("button", { name: "Download again" })).toBeInTheDocument();
    });

    it("downloads a finished run once by itself and offers it again", async () => {
        const { container } = render(surface.ui());
        choose(container, [pdf("report.pdf")]);
        surface.run();
        await screen.findByRole("heading", { level: 2 });
        if (surface.review) {
            // The text is on the page to read and copy; the visitor downloads it when they choose.
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
            expect(downloadBlob).not.toHaveBeenCalled();
            expect(screen.getByRole("button", { name: surface.review })).toBeInTheDocument();
            return;
        }
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
        // A later render never downloads again: only the visitor's click does.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Download again" }));
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
        expect(vi.mocked(downloadBlob).mock.calls[1][1]).toBe(vi.mocked(downloadBlob).mock.calls[0][1]);
    });
});

describe("several files in one run", () => {
    it.each([
        ["GenericUI", () => <GenericUI slug="grayscale-pdf" toolName="Grayscale PDF" actionLabel="Make it grey" outputLabel="grey.pdf" accepts=".pdf" />, /^Make it grey/],
        ["SimpleConvertUI", () => <SimpleConvertUI slug="flatten-pdf" label="Flatten PDF" outputExt="pdf" outputFilename="flattened.pdf" acceptFileTypes=".pdf" description="Flatten PDFs" />, /^Flatten PDF/],
        ["Crop PDF", () => <CropUI />, /^Crop 2 PDFs/],
    ] as const)("%s downloads one ZIP, once, and offers it again", async (_name, ui, run) => {
        const { container } = render(ui());
        choose(container, [pdf("one.pdf"), pdf("two.pdf")]);
        fireEvent.click(screen.getByRole("button", { name: run }));
        await screen.findByRole("heading", { level: 2 });
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
        expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/\.zip$/);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Download ZIP again" }));
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    });
});

describe("Bates Numbering's production set", () => {
    const zip = () => ({ blob: async () => new Blob(["zip"], { type: "application/zip" }), headers: new Headers({ "X-Bates-Manifest": JSON.stringify([{ index: 0, pages: 2, firstBates: "DOC-000001", lastBates: "DOC-000002", file: "a.pdf" }, { index: 1, pages: 1, firstBates: "DOC-000003", lastBates: "DOC-000003", file: "b.pdf" }]) }) }) as unknown as Response;

    it("numbers several files as one set, downloads the ZIP once and offers it again", async () => {
        vi.mocked(uploadFiles).mockResolvedValueOnce(zip());
        const { container } = render(<TooltipProvider><BatesUI /></TooltipProvider>);
        choose(container, [pdf("a.pdf"), pdf("b.pdf")]);
        fireEvent.click(screen.getByRole("button", { name: /^Stamp 2 PDFs/ }));
        expect(await screen.findByRole("heading", { level: 2, name: "Numbered DOC-000001 to DOC-000003." })).toHaveFocus();
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Download ZIP again" }));
        expect(downloadBlob).toHaveBeenCalledTimes(2);
        expect(vi.mocked(downloadBlob).mock.calls[1][1]).toBe("bates_numbered.zip");
    });

    it.each([
        [400, "One of these files isn’t a PDF.", false],
        [503, "The server is busy. Please try again.", true],
    ])("ends a failed set (%i) on the failure result, with a retry only when another attempt could work", async (status, message, retryable) => {
        vi.mocked(uploadFiles).mockRejectedValueOnce(httpError(status, message));
        const { container } = render(<TooltipProvider><BatesUI /></TooltipProvider>);
        choose(container, [pdf("a.pdf"), pdf("b.pdf")]);
        fireEvent.click(screen.getByRole("button", { name: /^Stamp 2 PDFs/ }));
        expect(await screen.findByRole("heading", { level: 2, name: "None of these PDFs could be numbered." })).toHaveFocus();
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(container.querySelector(".ts-file[data-status=error]")).toHaveTextContent(message);
        expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(retryable);
        expect(downloadBlob).not.toHaveBeenCalled();
    });
});

describe("Subtitle Converter on the shared kit", () => {
    it("says a file that doesn't parse can't be converted, on its row, and offers no retry", async () => {
        const { container } = render(<SubtitleConverterUI />);
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["not a subtitle"], "notes.srt", { type: "application/x-subrip" })] } });
        await screen.findByRole("alert");
        expect(screen.getByRole("button", { name: /^Download \.vtt/ })).toBeDisabled();
    });

    it("converts, downloads once and offers it again", async () => {
        const srt = "1\n00:00:00,500 --> 00:00:03,200\nHello.\n";
        const { container } = render(<SubtitleConverterUI />);
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File([srt], "talk.srt", { type: "application/x-subrip" })] } });
        await waitFor(() => expect(screen.getByRole("button", { name: /^Download \.vtt/ })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: /^Download \.vtt/ }));
        expect(await screen.findByRole("heading", { level: 2, name: "Saved as .vtt." })).toHaveFocus();
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
        expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe("talk.vtt");
        fireEvent.click(screen.getByRole("button", { name: "Download again" }));
        expect(downloadBlob).toHaveBeenCalledTimes(2);
    });
});
