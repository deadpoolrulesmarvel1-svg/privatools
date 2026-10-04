import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolSeo } from "@/lib/tool-seo";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { UPLOADS_WHEN_CHOSEN, hasOwnLocation, toolLocation } from "./tool-location";
import { ToolWorkspace } from "./ToolWorkspace";
import { FileIntake } from "./ToolStudio";
import { CompareUI } from "@/components/tool-ui/CompareUI";
import { AttachmentUI } from "@/components/tool-ui/AttachmentUI";
import { AlternateMixUI } from "@/components/tool-ui/AlternateMixUI";
import { OverlayUI } from "@/components/tool-ui/OverlayUI";
import { UrlToPdfUI } from "@/components/tool-ui/UrlToPdfUI";
import { HtmlToPdfUI } from "@/components/tool-ui/HtmlToPdfUI";

vi.mock("../daylight/consumer/ConsumerChrome", () => ({ FavoriteButton: () => null }));
vi.mock("./ToolGuide", () => ({ ToolGuide: ({ slug }: { slug: string }) => <div data-testid="guide">{slug}</div> }));
afterEach(cleanup);

const COMPRESS = { slug: "compress-pdf", name: "Compress PDF", seoTitle: "Compress PDF Online Free – Shrink Your File Size", description: "Reduce the file size of your PDF", category: "pdf" };

async function page(tool: Parameters<typeof ToolWorkspace>[0]["tool"], children: React.ReactNode = <div>File picker</div>) {
    await act(async () => { render(<ToolWorkspace tool={tool} categoryLabel="PDF" related={[]} onFindTool={() => undefined}>{children}</ToolWorkspace>); });
}

describe("tool page heading", () => {
    it("is the tool's name and its one-line promise; the search title stays in the tab", async () => {
        await page(COMPRESS);
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1).toHaveTextContent(/^Compress PDF: Reduce the file size of your PDF$/);
        expect(h1).toHaveAccessibleName("Compress PDF: Reduce the file size of your PDF");
        expect(h1).not.toHaveTextContent("Online Free");
        // Two lines on screen: the name, then the promise.
        expect(h1.querySelector(".tw-name")).toHaveTextContent(/^Compress PDF:$/);
        expect(h1.querySelector(".tw-name .sr-only")).toHaveTextContent(/^:$/);
        expect(h1.querySelector(".tw-promise")).toHaveTextContent(/^Reduce the file size of your PDF$/);
        expect(screen.queryByText("Compress PDF Online Free – Shrink Your File Size")).toBeNull();
    });

    it("says what the crawler HTML says for every registered tool (backend _tool_page_body)", async () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/tool-content.json"), "utf8")) as { slug: string; name: string; description: string; seoTitle?: string; category: string }[];
        expect(manifest.length).toBeGreaterThan(200);
        for (const row of manifest) {
            const promise = row.description?.trim();
            expect(toolSeo(row).h1).toBe(promise ? `${row.name}: ${promise}` : row.name);
            if (row.seoTitle) expect(toolSeo(row).title).toBe(row.seoTitle);
        }
        for (const row of manifest.slice(0, 3)) {
            await page(row);
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(toolSeo(row).h1);
            cleanup();
        }
    });
});

describe("where the file goes", () => {
    it.each([
        { slug: "remove-background", name: "Background Remover", label: "Browser or server · your choice.", says: [/default server engine uploads images/, /Both options work without an account or an AI provider key/] },
        // OCR PDF and Image OCR offer a server engine, the visitor's AI key and an in-browser engine, in their engine cards' words.
        { slug: "ocr-pdf", name: "OCR PDF", label: "Server, your AI key or this browser · your choice.", says: [/On our server, Tesseract reads the PDF in temporary storage and the files are deleted after processing\./, /With your own AI key, each page is rendered to an image and sent to the provider you choose\./, /In this browser, tesseract\.js reads the pages on your device and nothing uploads\./] },
        { slug: "image-ocr", name: "Image OCR", label: "Server, your AI key or this browser · your choice.", says: [/On our server, Tesseract reads the image in temporary storage and deletes it after processing\./, /With your own AI key, the image goes to the provider you choose, not to PrivaTools\./, /In this browser, tesseract\.js reads it on your device and nothing uploads\./] },
    ])("gives $name the choice its engine picker offers, not just the server's", async ({ slug, name, label, says }) => {
        await page({ slug, name, description: "Pick an engine", category: "image" }, <div>Engine selector</div>);
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText(/Temporary server processing/)).toBeNull();
        expect(document.querySelector("article.tw-workspace")).toHaveAttribute("data-where", "choice");
        fireEvent.click(screen.getByRole("button", { name: "How it works" }));
        for (const words of says) expect(screen.getAllByText(words).length).toBeGreaterThan(0);
    });

    it.each([
        { slug: "organize-pages", name: "Organize Pages", detail: "Your PDF is uploaded when you choose it, so PrivaTools can draw its page thumbnails, and again when you save. Both requests use temporary storage, and the job’s files are removed after each response." },
        { slug: "remove-watermark", name: "Remove Watermark", detail: "Your PDF is uploaded when you choose it, so PrivaTools can look for watermarks, and again when you remove the ones you confirm. Both requests use temporary storage, and the job’s files are removed after each response." },
    ])("says $name uploads the PDF as soon as it is chosen", async ({ slug, name, detail }) => {
        await page({ slug, name, description: "Work on a PDF", category: "pdf" });
        const where = document.querySelector(".tw-where-fallback")!;
        expect(where).toHaveTextContent(`Temporary server processing. ${detail} Read about file handling`);
        expect(where).not.toHaveTextContent(/only when you run the tool/);
        expect(UPLOADS_WHEN_CHOSEN).toContain(slug);
    });

    it.each([
        // "Detect form fields" uploads the PDF before the fill itself.
        { slug: "fill-form", name: "Fill PDF Form", detail: "Your PDF is uploaded when you select “Detect form fields”, so PrivaTools can read its fields, and again when you fill it. Both requests use temporary storage, and the job’s files are removed after each response." },
        // No file is chosen on these: the sentence names what is sent, and what the server fetches with it.
        // URL to PDF renders the page with the files it loads (stylesheets, web fonts, images, attachments);
        // HTML to PDF fetches an address's HTML alone, and for pasted HTML the files that HTML loads.
        { slug: "url-to-pdf", name: "URL to PDF", detail: "Only the address you enter leaves your device. When you run the tool, PrivaTools fetches that public page and the files it loads, such as its stylesheets, fonts and images, then renders the PDF in temporary storage and removes the job’s files after the response." },
        { slug: "html-to-pdf", name: "HTML to PDF", detail: "When you run the tool, the address or the HTML you enter is sent to PrivaTools. It fetches the page at that address, or the files your HTML loads, such as stylesheets, fonts and images, then renders the PDF in temporary storage and removes the job’s files after the response." },
        { slug: "generate-barcode", name: "Generate Barcode", detail: "When you run the tool, the text you enter is sent to PrivaTools, which draws the barcode in temporary storage and removes the job’s files after the response." },
        { slug: "qr-code", name: "QR Code", detail: "When you run the tool, the text you enter, and a logo if you add one, is sent to PrivaTools, which draws the QR code in temporary storage and removes the job’s files after the response." },
    ])("says exactly what $name sends and when", async ({ slug, name, detail }) => {
        await page({ slug, name, description: "Make something", category: "pdf" });
        const where = document.querySelector(".tw-where-fallback")!;
        expect(where).toHaveTextContent(`Temporary server processing. ${detail} Read about file handling`);
        expect(where).not.toHaveTextContent(/Files are uploaded only when you run the tool/);
        expect(UPLOADS_WHEN_CHOSEN).not.toContain(slug);
    });

    it.each([
        { slug: "compare-pdf", name: "Compare PDF", ui: <CompareUI /> },
        { slug: "add-attachment", name: "Add Attachment", ui: <AttachmentUI /> },
        // The two named inputs of the shared kit (PairedIntake).
        { slug: "alternate-mix", name: "Alternate Mix", ui: <AlternateMixUI /> },
        { slug: "overlay", name: "Overlay PDF", ui: <OverlayUI /> },
    ])("says it once, in full, under $name's two intakes, before and after both files are chosen", async ({ slug, name, ui }) => {
        await page({ slug, name, description: "Two files", category: "pdf" }, ui);
        const full = "Temporary server processing. Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.";
        expect(document.querySelectorAll(".ts-paired-where")).toHaveLength(1);
        expect(document.querySelector(".ts-paired-where")).toHaveTextContent(full);
        const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
        const inputs = [...document.querySelectorAll<HTMLInputElement>(".ts-paired-inputs input[type=file]")];
        await act(async () => { fireEvent.change(inputs[0], { target: { files: [pdf("first.pdf")] } }); });
        await act(async () => { fireEvent.change(document.querySelector<HTMLInputElement>(".ts-paired-inputs input[type=file]")!, { target: { files: [slug === "add-attachment" ? new File(["notes"], "notes.txt", { type: "text/plain" }) : pdf("second.pdf")] } }); });
        expect(document.querySelectorAll(".ts-paired-inputs input[type=file]")).toHaveLength(0);
        expect(document.querySelectorAll(".ts-paired-where")).toHaveLength(1);
        expect(document.querySelector(".ts-paired-where")).toHaveTextContent(full);
        expect(document.querySelector("article.tw-workspace")).toHaveAttribute("data-own-where");
    });

    it.each([
        { slug: "url-to-pdf", name: "URL to PDF", ui: <UrlToPdfUI /> },
        { slug: "html-to-pdf", name: "HTML to PDF", ui: <HtmlToPdfUI /> },
    ])("says it once, in full, in $name's own intake, which takes no file, and in its action bar by its label", async ({ slug, name, ui }) => {
        await page({ slug, name, description: "No file", category: "developer" }, ui);
        expect(document.querySelectorAll(".ts-source-where")).toHaveLength(1);
        expect(document.querySelector(".ts-source-where")).toHaveTextContent(`Temporary server processing. ${toolLocation({ slug }).detail} Read about file handling`);
        // The page's own line stays out: the tool says it.
        expect(document.querySelector("article.tw-workspace")).toHaveAttribute("data-own-where");
        expect(document.querySelector(".ts-action-bar .ts-action-where")).toHaveTextContent("Temporary server processing");
        expect(document.querySelector("input[type=file]")).toBeNull();
    });

    it("says, per AI tool, what reaches the provider, what reaches PrivaTools, and what stays on the device", () => {
        const detail = (slug: string) => toolLocation({ slug, byok: true }).detail;
        // Summarize, Chat and Transcribe never contact PrivaTools.
        expect(detail("summarize-pdf")).toBe("Choose where the model runs before summarizing. On this device, a model downloads once and the PDF stays in your browser. With your own API key, the PDF’s text goes to the provider you choose, not to PrivaTools.");
        expect(detail("chat-with-pdf")).toBe("The PDF is read on your device. Each question is sent, with the document text, straight from your browser to the provider you choose, using your key. It never passes through PrivaTools.");
        expect(detail("transcribe-audio")).toBe("Choose where the AI runs before transcribing. On this device, Whisper downloads once and the recording never leaves your browser. With your own API key, the audio goes directly to the provider you choose.");
        // Translate renders a PDF of the translated text on the server; Smart Redact removes the selections there.
        expect(detail("translate-pdf")).toMatch(/“Save as PDF” sends the translated text, never the original file, to PrivaTools to be rendered, then deletes it\.$/);
        expect(detail("smart-redact")).toMatch(/When you apply, the PDF and the strings you selected are sent to PrivaTools to be removed, then deleted on response\.$/);
        for (const slug of ["summarize-pdf", "chat-with-pdf", "transcribe-audio", "ai-token-counter"]) expect(detail(slug)).not.toMatch(/also use PrivaTools|sent to PrivaTools|PrivaTools to /);
        // The token counter counts GPT here and asks a provider only with the visitor's key, when they choose.
        expect(detail("ai-token-counter")).toBe("Files are read and GPT tokens are counted in this browser, so nothing is uploaded. With your own Anthropic or Google key, and only when you choose to count with it, the text you count goes from your browser straight to that provider, never through PrivaTools.");
        // Where an on-device engine exists, it is named.
        for (const slug of ["summarize-pdf", "transcribe-audio", "translate-pdf", "smart-redact"]) expect(detail(slug)).toMatch(/On this device/);
        // A tool that can use the visitor's AI key always gets words of its own: what goes where differs per tool.
        const ai = [...tools, ...nonPdfTools].filter(tool => tool.byok).map(tool => tool.slug);
        expect(ai.length).toBeGreaterThan(0);
        expect(ai.filter(slug => !hasOwnLocation(slug))).toEqual([]);
    });

    it("keeps an ordinary server tool's disclosure, as readable text with a way to read more", async () => {
        await page(COMPRESS);
        const where = document.querySelector(".tw-where-fallback")!;
        expect(where).toHaveTextContent("Temporary server processing. Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.");
        expect(within(where as HTMLElement).getByRole("link", { name: "Read about file handling" })).toHaveAttribute("href", "/trust");
        expect(screen.getByTestId("guide")).toHaveTextContent("compress-pdf");
        expect(document.querySelector(".tw-task-shelf, .tw-processing")).toBeNull();
    });

    it("says it inside the intake of a tool built on the shared kit, and the page line steps aside for it", async () => {
        await page({ ...COMPRESS, slug: "json-xml-formatter", name: "JSON / XML Formatter", clientOnly: true }, <div className="tool-studio"><FileIntake accepts=".json" title="Your JSON" onFiles={() => undefined} /></div>);
        const intake = document.querySelector(".ts-intake")!;
        expect(intake).toHaveTextContent("Stays on your device. Processing happens in this browser. Your input stays on this device.");
        // Clicking the link reads about file handling; it does not open the file chooser.
        const input = intake.querySelector<HTMLInputElement>("input[type=file]")!;
        const choose = vi.spyOn(input, "click").mockImplementation(() => {});
        fireEvent.click(within(intake as HTMLElement).getByRole("link", { name: "Read about file handling" }));
        expect(choose).not.toHaveBeenCalled();
        const css = readFileSync(join(process.cwd(), "src/skins/experience/tool-workspace.css"), "utf8");
        expect(css).toContain('.tw-workspace:has(.tw-working-area :is(.tool-studio,.ms-workspace,.merge-workbench,.consumer-formatter,.tool-where,[aria-label^="Loading"])) .tw-where-fallback,.tw-workspace[data-own-where] .tw-where-fallback{display:none}');
        expect(document.querySelector("article.tw-workspace")).toHaveAttribute("data-own-where");
    });

    it("keeps the line where the tool first said it: an editor replacing its intake brings no page line in", async () => {
        function Editor() {
            const [chosen, setChosen] = useState(false);
            return chosen ? <div className="pdf-full-editor">Editing report.pdf</div> : <FileIntake accepts=".pdf" title="Your PDF" onFiles={() => setChosen(true)} />;
        }
        await page({ ...COMPRESS, slug: "sign-pdf", name: "Sign PDF" }, <Editor />);
        const article = document.querySelector("article.tw-workspace")!;
        expect(article).toHaveAttribute("data-own-where");
        await act(async () => { fireEvent.change(document.querySelector<HTMLInputElement>(".ts-intake input[type=file]")!, { target: { files: [new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" })] } }); });
        expect(screen.getByText("Editing report.pdf")).toBeInTheDocument();
        expect(document.querySelector(".ts-intake")).toBeNull();
        expect(article).toHaveAttribute("data-own-where");
    });

    it("keeps the page line for a tool UI that never says where the file goes itself", async () => {
        await page({ ...COMPRESS, slug: "organize-pages", name: "Organize Pages" }, <div className="organize-workbench">Drop a PDF</div>);
        expect(document.querySelector("article.tw-workspace")).not.toHaveAttribute("data-own-where");
        expect(document.querySelector(".tw-where-fallback")).not.toBeNull();
    });
});

describe("page utilities", () => {
    it("opens the tool search from a search control, not an external-link arrow", async () => {
        const onFindTool = vi.fn();
        await act(async () => { render(<ToolWorkspace tool={COMPRESS} categoryLabel="PDF" related={[]} onFindTool={onFindTool}><div /></ToolWorkspace>); });
        const find = screen.getByRole("button", { name: "Find another tool" });
        expect(find.querySelector(".lucide-search")).not.toBeNull();
        expect(find.querySelector(".lucide-arrow-up-right")).toBeNull();
        fireEvent.click(find);
        expect(onFindTool).toHaveBeenCalledTimes(1);
    });
});
