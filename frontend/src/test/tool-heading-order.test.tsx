/**
 * The tool page's heading outline, as axe's heading-order rule reads it: one
 * H1 (the tool's name and promise), and no level skipped after it, before and
 * after a file is chosen. Step 1's review left axe flagging the intake's h3
 * straight after the H1 and a file row's h4 under a result's h2.
 */
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolWorkspace } from "@/skins/experience/ToolWorkspace";
import { CompressUI } from "@/components/tool-ui/CompressUI";
import { GenericUI } from "@/components/tool-ui/GenericUI";
import { MergeUI } from "@/components/tool-ui/MergeUI";
import { ImageConverterUI } from "@/components/tool-ui/ImageConverterUI";
import { CompressVideoUI } from "@/components/tool-ui/CompressVideoUI";
import { GeminiWatermarkUI } from "@/components/tool-ui/GeminiWatermarkUI";
import { JsonXmlFormatterUI } from "@/components/tool-ui/JsonXmlFormatterUI";
import { HiddenTextCheckerUI } from "@/components/tool-ui/HiddenTextCheckerUI";
import { CropUI } from "@/components/tool-ui/CropUI";
import { WatermarkUI } from "@/components/tool-ui/WatermarkUI";
import { MetadataUI } from "@/components/tool-ui/MetadataUI";
import { ProtectUI } from "@/components/tool-ui/ProtectUI";
import { SubtitleGeneratorUI } from "@/components/tool-ui/SubtitleGeneratorUI";

vi.mock("@/skins/daylight/consumer/ConsumerChrome", () => ({ FavoriteButton: () => null }));
vi.mock("@/skins/experience/ToolGuide", () => ({ ToolGuide: () => <section><h2>How to use this tool</h2><h3>A question</h3></section> }));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/tool-ui/merge-preview", () => ({
    openMergePreview: vi.fn(async () => ({
        numPages: 2, destroy: vi.fn(async () => {}),
        getPage: vi.fn(async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }) })),
    })),
}));
vi.mock("@/components/tool-ui/pdf/PdfPageStage", () => ({ PdfPageStage: () => <div data-testid="stage" /> }));
vi.mock("@/components/tool-ui/pdf/PdfWatermarkPreview", () => ({ PdfWatermarkPreview: () => null }));
vi.mock("@/components/VaultPasswordPicker", () => ({ VaultPasswordPicker: () => null }));
vi.mock("@/components/AssetPicker", () => ({ AssetPicker: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn(), success: vi.fn() }) }));
afterEach(cleanup);

const pdf = (name: string) => new File(["%PDF-1.7 synthetic"], name, { type: "application/pdf" });
const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const mp4 = (name: string) => new File([new Uint8Array([0, 0, 0, 24])], name, { type: "video/mp4" });

/** Every heading's level in document order, and the first skip if any. */
function outline() {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(h => ({ level: Number(h.tagName[1]), text: (h.textContent || "").trim() }));
    let previous = 0;
    const skips: string[] = [];
    for (const heading of headings) {
        if (previous && heading.level > previous + 1) skips.push(`h${previous} → h${heading.level} "${heading.text}"`);
        previous = heading.level;
    }
    return { headings, skips };
}

type Case = { name: string; tool: { slug: string; name: string; description: string; category: string; clientOnly?: boolean }; ui: () => ReactElement; choose: (container: HTMLElement) => void };
const fileInput = (container: HTMLElement, files: File[]) => fireEvent.change(container.querySelector("input[type=file]")!, { target: { files } });
const CASES: Case[] = [
    { name: "Compress PDF", tool: { slug: "compress-pdf", name: "Compress PDF", description: "Reduce the file size of your PDF", category: "optimize" }, ui: () => <CompressUI />, choose: c => fileInput(c, [pdf("report.pdf")]) },
    { name: "a GenericUI tool", tool: { slug: "web-optimize-pdf", name: "Web Optimize PDF", description: "Make a PDF load fast", category: "optimize" }, ui: () => <GenericUI slug="web-optimize-pdf" toolName="Web Optimize PDF" outputLabel="optimized.pdf" accepts=".pdf" />, choose: c => fileInput(c, [pdf("report.pdf")]) },
    { name: "Merge PDF", tool: { slug: "merge-pdf", name: "Merge PDF", description: "Combine multiple PDFs into one", category: "organize" }, ui: () => <MergeUI />, choose: c => fireEvent.change(c.querySelector("input[aria-label='Choose PDFs to merge']")!, { target: { files: [pdf("a.pdf"), pdf("b.pdf")] } }) },
    { name: "Image Converter", tool: { slug: "image-converter", name: "Image Format Converter", description: "Convert between WebP, PNG, JPG, BMP, and TIFF", category: "image" }, ui: () => <ImageConverterUI />, choose: c => fileInput(c, [png("photo.png")]) },
    { name: "Compress Video", tool: { slug: "compress-video", name: "Compress Video", description: "Reduce video file size for email or messaging", category: "video-audio" }, ui: () => <CompressVideoUI />, choose: c => fileInput(c, [mp4("clip.mp4")]) },
    { name: "Gemini Watermark Remover", tool: { slug: "gemini-watermark-remover", name: "Gemini Watermark Remover", description: "Take the visible Gemini sparkle off AI-generated images", category: "image", clientOnly: true }, ui: () => <GeminiWatermarkUI />, choose: c => fileInput(c, [png("gemini.png")]) },
    { name: "JSON / XML Formatter", tool: { slug: "json-xml-formatter", name: "JSON / XML Formatter", description: "Prettify, minify or validate JSON and XML in your browser", category: "developer", clientOnly: true }, ui: () => <JsonXmlFormatterUI />, choose: () => fireEvent.change(document.querySelector("textarea")!, { target: { value: '{"a":1}' } }) },
    { name: "Subtitle Generator", tool: { slug: "subtitle-generator", name: "Subtitle Generator", description: "Turn the speech in a video or recording into subtitles", category: "video-audio", clientOnly: true }, ui: () => <SubtitleGeneratorUI />, choose: c => fileInput(c, [mp4("talk.mp4")]) },
    { name: "Hidden Text Checker", tool: { slug: "hidden-text-checker", name: "Hidden Text Checker", description: "Find text in a PDF that readers can't see", category: "security" }, ui: () => <HiddenTextCheckerUI />, choose: c => fileInput(c, [pdf("notes.pdf")]) },
    // Screens moved onto the shared kit in step 2b: their options are h2 parts of the tool.
    { name: "Crop PDF", tool: { slug: "crop-pdf", name: "Crop PDF", description: "Trim the margins of a PDF", category: "edit" }, ui: () => <CropUI />, choose: c => fileInput(c, [pdf("report.pdf")]) },
    { name: "Watermark PDF", tool: { slug: "watermark", name: "Watermark PDF", description: "Add a watermark to a PDF", category: "edit" }, ui: () => <WatermarkUI />, choose: c => fileInput(c, [pdf("report.pdf")]) },
    { name: "Metadata", tool: { slug: "metadata", name: "Edit Metadata", description: "View and edit PDF properties", category: "edit" }, ui: () => <MetadataUI />, choose: c => fileInput(c, [pdf("report.pdf")]) },
    { name: "Protect PDF", tool: { slug: "protect-pdf", name: "Protect PDF", description: "Add a password to a PDF", category: "security" }, ui: () => <ProtectUI />, choose: c => fileInput(c, [pdf("report.pdf")]) },
];

describe("tool page heading order", () => {
    it.each(CASES)("$name: one H1, then no skipped level, before and after a file is chosen", async ({ tool, ui, choose }) => {
        let container!: HTMLElement;
        await act(async () => { ({ container } = render(<ToolWorkspace tool={tool} categoryLabel="Tools" related={[]} onFindTool={() => undefined}>{ui()}</ToolWorkspace>)); });
        const open = outline();
        expect(open.headings[0]).toMatchObject({ level: 1, text: `${tool.name}: ${tool.description}` });
        expect(open.headings.filter(h => h.level === 1)).toHaveLength(1);
        expect(open.skips).toEqual([]);
        await act(async () => { choose(container); await new Promise(resolve => setTimeout(resolve, 50)); });
        const chosen = outline();
        expect(chosen.headings.filter(h => h.level === 1)).toHaveLength(1);
        expect(chosen.skips).toEqual([]);
    });
});
