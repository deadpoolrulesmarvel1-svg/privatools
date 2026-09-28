/**
 * What each tool's page sends when its visitor chooses the first or the second
 * page, held to page-contract.json.
 *
 * Redact PDF's page sent the page number it showed, 1 for the first page, to a
 * route that counts pages from 0, so it blacked out the page after the one the
 * visitor chose. backend/tests/test_page_contract.py sends the values in
 * page-contract.json through the real routes and checks where the change
 * lands; these tests check that the pages send those values. The pages run as
 * they are, with the real PdfPageStage and upload helpers, and pdf.js opens
 * real PDFs: only its drawing, the canvas and the network are replaced.
 *
 * The same goes for where a drawn box lands. On a page stored turned
 * (/Rotate), or whose visible area does not start at 0,0, a box sent as the
 * preview showed it landed somewhere else, and a redaction hid nothing. The
 * "turned" section of page-contract.json says what each page must send for a
 * box drawn on such pages; the backend test checks that the routes put it
 * back on the drawn box.
 */
import type { ReactElement } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import contract from "./page-contract.json";
import { installNetwork, type SentRequest } from "./fake-network";
import type { PageSpec } from "./pdf-pages";
import { RedactUI } from "@/components/tool-ui/RedactUI";
import { WhiteoutUI } from "@/components/tool-ui/WhiteoutUI";
import { AnnotateUI } from "@/components/tool-ui/AnnotateUI";
import { ShapesUI } from "@/components/tool-ui/ShapesUI";
import { FormCreatorUI } from "@/components/tool-ui/FormCreatorUI";
import { ESignUI } from "@/components/tool-ui/ESignUI";
import { SignUI } from "@/components/tool-ui/SignUI";
import { BookmarksUI } from "@/components/tool-ui/BookmarksUI";
import { DeletePagesUI } from "@/components/tool-ui/DeletePagesUI";
import { ExtractPagesUI } from "@/components/tool-ui/ExtractPagesUI";
import { OrganizeUI } from "@/components/tool-ui/OrganizeUI";
import { MergeUI } from "@/components/tool-ui/MergeUI";
import { RotateUI } from "@/components/tool-ui/RotateUI";
import { SplitUI } from "@/components/tool-ui/SplitUI";
import { StampUI } from "@/components/tool-ui/StampUI";
import { CropUI } from "@/components/tool-ui/CropUI";
import { PdfPageStage } from "@/components/tool-ui/pdf/PdfPageStage";

const LETTER: PageSpec = { mediabox: [0, 0, 612, 792] };
// The PDF the preview opens: two US Letter pages unless a test says otherwise.
const preview = vi.hoisted(() => ({ pages: null as PageSpec[] | null, shown: [612, 792] }));
vi.mock("@/components/tool-ui/merge-preview", async () => {
    const { openPdf, pdfBytes } = await import("./pdf-pages");
    return { openMergePreview: vi.fn(async () => openPdf(pdfBytes(preview.pages ?? [LETTER, LETTER]))) };
});
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/lib/signatureStore", () => ({ loadSignature: vi.fn(async () => null), saveSignature: vi.fn(), forgetSignature: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// Each test renders a whole tool page; on a busy machine that can take longer
// than Testing Library's default 1 s wait.
configure({ asyncUtilTimeout: 5000 });

type Slug = keyof typeof contract.tools;
const PAGES = [["first", 1], ["second", 2]] as const;
const expected = (slug: Slug, which: "first" | "second") => contract.tools[slug][which];

let requests: SentRequest[] = [];
const pdf = (name = "two-pages.pdf") => new File(["%PDF-1.7 two pages"], name, { type: "application/pdf" });

beforeEach(() => {
    localStorage.clear();
    preview.pages = null;
    preview.shown = [612, 792];
    ({ requests } = installNetwork(() => ({ uploadMs: 0, answerAfterMs: 0, body: "%PDF-1.7 result", headers: { "content-type": "application/pdf" } })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,aW5r");
    // The page is drawn at its size as shown, one CSS pixel per point, so a
    // drag's client coordinates are points on the page as shown.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => {
        const [width, height] = preview.shown;
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    // Downloads click a link; jsdom cannot follow it.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function choose(input: Element, files: File[]) { fireEvent.change(input, { target: { files } }); }
function pdfInput(container: HTMLElement) { return container.querySelector<HTMLInputElement>('input[type="file"]')!; }
/** PdfPageStage has opened the PDF and its first page. */
async function stageReady() {
    await waitFor(() => {
        expect(screen.getByLabelText("Preview page")).toBeEnabled();
        expect(screen.queryByText("Opening your page…")).toBeNull();
    });
}
function showPage(page: number) { if (page !== 1) fireEvent.change(screen.getByLabelText("Preview page"), { target: { value: String(page) } }); }
const DRAWN = contract.turned.drawn;
/** Drag across the shown page, as a visitor places a region, once the page has opened. */
async function drawRegion(label: string, box = DRAWN) {
    await waitFor(() => expect(screen.getByRole("button", { name: label })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: label }));
    const layer = screen.getByLabelText("Placed regions");
    fireEvent.pointerDown(layer, { clientX: box.x, clientY: box.y, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: box.x + box.width, clientY: box.y + box.height, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: box.x + box.width, clientY: box.y + box.height, pointerId: 1 });
}
/** The form the page sent to `endpoint`. */
async function sent(endpoint: string): Promise<FormData> {
    let request: SentRequest | undefined;
    await waitFor(() => {
        request = requests.find(r => r.url.endsWith(`/api${endpoint}`));
        expect(request).toBeDefined();
    });
    return request!.body as FormData;
}
const jsonField = (form: FormData, name: string) => JSON.parse(String(form.get(name))) as Record<string, unknown>[];

describe("the page each tool's page sends", { timeout: 20_000 }, () => {
    // Each drawing tool starts with one region on page 1; the visitor then draws
    // a second one on the page they choose.
    const drawing: [Slug, () => ReactElement, string, RegExp][] = [
        ["redact-pdf", () => <RedactUI />, "Draw a region", /^Redact 2 regions/],
        ["whiteout-pdf", () => <WhiteoutUI />, "Draw a region", /^Apply 2 white-outs/],
        ["annotate-pdf", () => <AnnotateUI />, "Draw a region", /^Apply 2 annotations/],
        ["add-shapes", () => <ShapesUI />, "Draw a region", /^Add 2 shapes/],
        ["form-creator", () => <FormCreatorUI />, "Draw a field", /^Generate fillable PDF/],
    ];
    for (const [slug, ui, drawLabel, action] of drawing) {
        it.each(PAGES)(`${slug}: a region drawn on the %s page`, async (which, page) => {
            const { container } = render(ui());
            choose(pdfInput(container), [pdf()]);
            await stageReady();
            showPage(page);
            await drawRegion(drawLabel);
            const button = await screen.findByRole("button", { name: action });
            fireEvent.click(button);
            const spec = contract.tools[slug];
            const items = jsonField(await sent(spec.endpoint), spec.field);
            expect(items.map(item => item.page)).toEqual([expected(slug, "first"), expected(slug, which)]);
        });
    }

    it.each(PAGES)("esign-pdf: a signature placed on the %s page", async (which, page) => {
        const { container } = render(<ESignUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        fireEvent.click(screen.getByRole("tab", { name: "Type" }));
        fireEvent.change(screen.getByPlaceholderText("Type your name…"), { target: { value: "Alex Example" } });
        showPage(page);
        await drawRegion("Place signature");
        fireEvent.click(screen.getByRole("button", { name: "Apply e-signature" }));
        expect((await sent("/esign-pdf")).get("page")).toBe(String(expected("esign-pdf", which)));
    });

    it.each(PAGES)("sign-pdf: a signature placed on the %s page", async (which, page) => {
        const { container } = render(<SignUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        const signature = new File([new Uint8Array([137, 80, 78, 71])], "signature.png", { type: "image/png" });
        choose(container.querySelector('input[type="file"][accept=".png,.jpg,.jpeg"]')!, [signature]);
        showPage(page);
        await drawRegion("Place signature");
        fireEvent.click(await screen.findByRole("button", { name: /^Sign PDF/ }));
        expect((await sent("/sign-pdf")).get("page")).toBe(String(expected("sign-pdf", which)));
    });

    it.each(PAGES)("bookmarks: a bookmark pointing at the %s page", async (which, page) => {
        const { container } = render(<BookmarksUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        fireEvent.change(screen.getByLabelText("Bookmark 1 page"), { target: { value: String(page) } });
        fireEvent.click(screen.getByRole("button", { name: /^Add bookmarks/ }));
        const items = jsonField(await sent("/bookmarks"), "bookmarks");
        expect(items.map(item => item.page)).toEqual([expected("bookmarks", which), expected("bookmarks", "first")]);
    });

    const selecting: [Slug, () => ReactElement, string, string][] = [
        ["delete-pages", () => <DeletePagesUI />, "Remove page", "Delete pages"],
        ["extract-pages", () => <ExtractPagesUI />, "Keep page", "Extract pages"],
    ];
    for (const [slug, ui, pick, action] of selecting) {
        it.each(PAGES)(`${slug}: the %s page picked on the preview`, async (which, page) => {
            const { container } = render(ui());
            choose(pdfInput(container), [pdf()]);
            await stageReady();
            showPage(page);
            fireEvent.click(screen.getByRole("button", { name: `${pick} ${page}` }));
            fireEvent.click(screen.getByRole("button", { name: action }));
            expect((await sent(contract.tools[slug].endpoint)).get("pages")).toBe(expected(slug, which));
        });
    }

    it.each(PAGES)("organize-pages: only the %s page kept", async (which, page) => {
        vi.unstubAllGlobals();
        ({ requests } = installNetwork(index => index === 0
            ? { uploadMs: 0, answerAfterMs: 0, body: JSON.stringify({ thumbnails: ["AAAA", "BBBB"] }), headers: { "content-type": "application/json" } }
            : { uploadMs: 0, answerAfterMs: 0, body: "%PDF-1.7 result", headers: { "content-type": "application/pdf" } }));
        const { container } = render(<OrganizeUI />);
        choose(pdfInput(container), [pdf()]);
        const removes = await screen.findAllByRole("button", { name: "Remove page" });
        fireEvent.click(removes[2 - page]);
        fireEvent.click(await screen.findByRole("button", { name: /^Apply & download/ }));
        expect(JSON.parse(String((await sent("/organize-pages")).get("page_order")))).toEqual(expected("organize-pages", which));
    });

    it.each(PAGES)("merge-pdf: only the %s page of each PDF included", async (which, page) => {
        render(<MergeUI />);
        choose(screen.getByLabelText("Choose PDFs to merge"), [pdf("a.pdf"), pdf("b.pdf")]);
        const other = 3 - page;
        fireEvent.click(await screen.findByRole("button", { name: `Exclude page ${other} of a.pdf` }));
        fireEvent.click(screen.getByRole("button", { name: `Exclude page ${other} of b.pdf` }));
        fireEvent.click(await screen.findByRole("button", { name: "Merge 2 pages" }));
        const value = expected("merge-pdf", which);
        expect(JSON.parse(String((await sent("/merge")).get("page_ranges")))).toEqual([value, value]);
    });

    it.each(PAGES)("rotate-pdf: the %s page typed as the pages to turn", async (which, page) => {
        const { container } = render(<RotateUI />);
        choose(pdfInput(container), [pdf()]);
        fireEvent.click(screen.getByRole("button", { name: "Specific pages" }));
        fireEvent.change(screen.getByLabelText("Apply to pages"), { target: { value: String(page) } });
        fireEvent.click(screen.getByRole("button", { name: /^Rotate PDF/ }));
        expect((await sent("/rotate")).get("pages")).toBe(expected("rotate-pdf", which));
    });

    it.each(PAGES)("split-pdf: the %s page typed as the pages to split out", async (which, page) => {
        const { container } = render(<SplitUI />);
        choose(pdfInput(container), [pdf()]);
        fireEvent.change(await screen.findByPlaceholderText("1-3, 5, 7-end, -4, 9-"), { target: { value: String(page) } });
        fireEvent.click(container.querySelector<HTMLButtonElement>("button.btn-accent")!);
        expect((await sent("/split")).get("pages")).toBe(expected("split-pdf", which));
    });

    it.each(PAGES)("stamp-pdf: the %s page typed as the pages to stamp", async (which, page) => {
        const { container } = render(<StampUI />);
        choose(pdfInput(container), [pdf()]);
        fireEvent.change(await screen.findByPlaceholderText("all · 1,3,5-8"), { target: { value: String(page) } });
        fireEvent.click(screen.getByRole("button", { name: /^Apply stamp/ }));
        expect((await sent("/stamp-pdf")).get("pages")).toBe(expected("stamp-pdf", which));
    });
});

describe("Redact PDF's page numbers", { timeout: 20_000 }, () => {
    it("names a page the PDF does not have in the page's own numbers, and sends nothing", async () => {
        const { container } = render(<RedactUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        const box = screen.getAllByLabelText("Pg")[0];
        expect(box).toHaveAttribute("max", "2");
        fireEvent.change(box, { target: { value: "3" } });
        fireEvent.click(screen.getByRole("button", { name: /^Redact 1 region/ }));
        expect(await screen.findByText("Box 1 is on page 3, which this PDF does not have. Choose a page from 1 to 2.")).toBeInTheDocument();
        expect(requests).toEqual([]);
    });
    it("sends the last page of the PDF as the route's last index", async () => {
        const { container } = render(<RedactUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        fireEvent.change(screen.getAllByLabelText("Pg")[0], { target: { value: "2" } });
        fireEvent.click(screen.getByRole("button", { name: /^Redact 1 region/ }));
        expect(jsonField(await sent("/redact"), "redactions")).toEqual([{ page: 1, x: 100, y: 700, width: 200, height: 20 }]);
        expect(await screen.findByText("Redacted")).toBeInTheDocument();
    });
});

describe("a box drawn on a turned or cropped page reaches the route where the page stores it", { timeout: 20_000 }, () => {
    type Box = { x: number; y: number; width: number; height: number };
    const box = (item: Record<string, unknown>): Box => ({ x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height) });
    const formBox = (form: FormData): Box => box(Object.fromEntries(["x", "y", "width", "height"].map(key => [key, form.get(key)])));
    // Each drawing tool, how it places a box, and where its request carries it.
    // The item tools start with one region on page 1; the drawn box is the second.
    const tools: [Slug, () => ReactElement, string, RegExp, (form: FormData) => Box, (() => void)?][] = [
        ["redact-pdf", () => <RedactUI />, "Draw a region", /^Redact 2 regions/, form => box(jsonField(form, "redactions")[1])],
        ["whiteout-pdf", () => <WhiteoutUI />, "Draw a region", /^Apply 2 white-outs/, form => box(jsonField(form, "regions")[1])],
        ["annotate-pdf", () => <AnnotateUI />, "Draw a region", /^Apply 2 annotations/, form => box(jsonField(form, "annotations")[1])],
        ["add-shapes", () => <ShapesUI />, "Draw a region", /^Add 2 shapes/, form => box(jsonField(form, "shapes")[1])],
        ["form-creator", () => <FormCreatorUI />, "Draw a field", /^Generate fillable PDF/, form => box(jsonField(form, "form_fields")[1])],
        ["esign-pdf", () => <ESignUI />, "Place signature", /^Apply e-signature/, formBox, () => {
            fireEvent.click(screen.getByRole("tab", { name: "Type" }));
            fireEvent.change(screen.getByPlaceholderText("Type your name…"), { target: { value: "Alex Example" } });
        }],
        ["sign-pdf", () => <SignUI />, "Place signature", /^Sign PDF/, formBox, () => {
            const signature = new File([new Uint8Array([137, 80, 78, 71])], "signature.png", { type: "image/png" });
            choose(document.querySelector('input[type="file"][accept=".png,.jpg,.jpeg"]')!, [signature]);
        }],
    ];
    const pages = Object.entries(contract.turned.pages);
    for (const [slug, ui, drawLabel, action, sentBox, prepare] of tools) {
        it.each(pages)(`${slug}: a box drawn on the %s page`, async (_name, spec) => {
            preview.pages = [spec];
            preview.shown = spec.shown;
            const { container } = render(ui());
            choose(pdfInput(container), [pdf()]);
            await stageReady();
            prepare?.();
            await drawRegion(drawLabel);
            fireEvent.click(await screen.findByRole("button", { name: action }));
            const route: { endpoint: string; frame?: string } = contract.tools[slug];
            const expected = route.frame === "unrotated"
                ? spec.unrotated
                : { ...DRAWN, y: spec.shown[1] - DRAWN.y - DRAWN.height };
            expect(route.frame).toMatch(/^(unrotated|shown-from-bottom)$/);
            expect(sentBox(await sent(route.endpoint))).toEqual(expected);
        });
    }

    it.each(pages)("the preview shows a box where it lands on the %s page", async (_name, spec) => {
        // Remove Watermark shows the boxes the route found, in the route's numbers.
        preview.pages = [spec];
        preview.shown = spec.shown;
        render(<PdfPageStage file={pdf()} regions={[{ id: "found", page: 1, ...spec.unrotated, kind: "rectangle", label: "Found box" }]} />);
        await stageReady();
        const rect = screen.getByLabelText("Found box").querySelector("rect")!;
        const shown = Object.fromEntries(["x", "y", "width", "height"].map(key => [key, Number(rect.getAttribute(key))]));
        expect(shown).toEqual(DRAWN);
    });

    it.each(pages)("crop-pdf: the area to keep drawn on the %s page", async (_name, spec) => {
        preview.pages = [spec];
        preview.shown = spec.shown;
        const { container } = render(<CropUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        await drawRegion("Draw the area to keep");
        fireEvent.click(screen.getByRole("button", { name: /^Crop PDF/ }));
        const crop = contract.turned["crop-pdf"];
        const form = await sent(crop.endpoint);
        const [width, height] = spec.shown;
        expect(Object.fromEntries(["top", "left", "right", "bottom", "margins_from"].map(key => [key, form.get(key)]))).toEqual({
            top: String(DRAWN.y), left: String(DRAWN.x),
            right: String(width - DRAWN.x - DRAWN.width), bottom: String(height - DRAWN.y - DRAWN.height),
            margins_from: crop.margins_from,
        });
    });

    it("add-shapes: a line drawn on a turned page keeps its ends", async () => {
        const spec = contract.turned.pages["rotate-90"];
        preview.pages = [spec];
        preview.shown = spec.shown;
        const { container } = render(<ShapesUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        await drawRegion("Draw a region");
        fireEvent.click(await screen.findByRole("button", { name: /^Add 2 shapes/ }));
        const shape = jsonField(await sent("/add-shapes"), "shapes")[1];
        const { x, y, width, height } = spec.unrotated;
        expect({ x: shape.x, y: shape.y, x2: shape.x2, y2: shape.y2 }).toEqual({ x, y, x2: x + width, y2: y + height });
    });
});

describe("a page the PDF does not have", { timeout: 20_000 }, () => {
    // White-Out, Annotate and Add Shapes sent such a page, and their routes
    // skipped it: the visitor got the file back unchanged.
    const tools: [Slug, () => ReactElement, string, RegExp, string][] = [
        ["whiteout-pdf", () => <WhiteoutUI />, "Page", /^Apply 1 white-out/, "Region 1 is on page 3, which this PDF does not have. Choose a page from 1 to 2."],
        ["annotate-pdf", () => <AnnotateUI />, "Page", /^Apply 1 annotation/, "Annotation 1 is on page 3, which this PDF does not have. Choose a page from 1 to 2."],
        ["add-shapes", () => <ShapesUI />, "Page", /^Add 1 shape/, "Shape 1 is on page 3, which this PDF does not have. Choose a page from 1 to 2."],
    ];
    it.each(tools)("%s: the page field stops at the last page, and a later page is refused in the page's numbers", async (_slug, ui, label, action, message) => {
        const { container } = render(ui());
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        const field = screen.getAllByLabelText(label).find(input => input.getAttribute("type") === "number")!;
        await waitFor(() => expect(field).toHaveAttribute("max", "2"));
        fireEvent.change(field, { target: { value: "3" } });
        fireEvent.click(screen.getByRole("button", { name: action }));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(requests).toEqual([]);
    });

    it("esign-pdf: the page field stops at the last page, and a later page is refused", async () => {
        // Its route signs page 1 instead of a page the PDF does not have.
        const { container } = render(<ESignUI />);
        choose(pdfInput(container), [pdf()]);
        await stageReady();
        fireEvent.click(screen.getByRole("tab", { name: "Type" }));
        fireEvent.change(screen.getByPlaceholderText("Type your name…"), { target: { value: "Alex Example" } });
        const field = screen.getAllByLabelText("Page").find(input => input.getAttribute("type") === "number")!;
        await waitFor(() => expect(field).toHaveAttribute("max", "2"));
        for (const label of ["X", "Y", "W", "H"]) expect(screen.getByLabelText(label)).toHaveAttribute("type", "number");
        fireEvent.change(field, { target: { value: "3" } });
        fireEvent.click(screen.getByRole("button", { name: "Apply e-signature" }));
        expect(await screen.findByText("The signature is on page 3, which this PDF does not have. Choose a page from 1 to 2.")).toBeInTheDocument();
        expect(requests).toEqual([]);
    });
});

describe("the contract covers every page that sends a page number", () => {
    // Tool pages that show PdfPageStage but send no page number, and why.
    const PREVIEW_ONLY: Record<string, string> = {
        "CropUI.tsx": "sends margins, which apply to every page",
        "FillFormUI.tsx": "sends field values by field name",
        "HiddenTextCheckerUI.tsx": "sends only the file; the pages it marks come from the server, counted from 1",
        "LongImageUI.tsx": "sends a format and a resolution; every page is joined",
        "PdfWatermarkPreview.tsx": "is Watermark's preview; the watermark goes on every page",
        "RemoveWatermarkUI.tsx": "sends the chosen watermark ids; the pages it shows come from the server, counted from 1",
    };
    const COVERED: Record<string, Slug[]> = {
        "RedactUI.tsx": ["redact-pdf"], "WhiteoutUI.tsx": ["whiteout-pdf"], "AnnotateUI.tsx": ["annotate-pdf"],
        "ShapesUI.tsx": ["add-shapes"], "FormCreatorUI.tsx": ["form-creator"], "ESignUI.tsx": ["esign-pdf"],
        "SignUI.tsx": ["sign-pdf"], "BookmarksUI.tsx": ["bookmarks"], "PdfPageSelectionUI.tsx": ["delete-pages", "extract-pages"],
    };
    it("lists every tool page that shows PdfPageStage", () => {
        const root = join(__dirname, "../components/tool-ui");
        const files = [root, join(root, "pdf")]
            .flatMap(dir => readdirSync(dir).map(name => join(dir, name)))
            .filter(path => path.endsWith(".tsx") && !path.includes(".test.") && basename(path) !== "PdfPageStage.tsx")
            .filter(path => /<PdfPageStage\b/.test(readFileSync(path, "utf8")))
            .map(path => basename(path));
        expect(files.length, "found no page that shows PdfPageStage; the search is broken").toBeGreaterThan(10);
        const unlisted = files.filter(name => !(name in PREVIEW_ONLY) && !(name in COVERED));
        expect(unlisted, "Add these pages to page-contract.json and this test, or to PREVIEW_ONLY with the reason they send no page number").toEqual([]);
        for (const slugs of Object.values(COVERED)) for (const slug of slugs) expect(contract.tools).toHaveProperty(slug);
    });
});
