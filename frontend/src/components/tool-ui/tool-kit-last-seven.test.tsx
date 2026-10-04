/**
 * The last seven tool screens on the shared kit (step 2c): Split PDF, Split by
 * Text, Unlock PDF, Alternate & Mix, Overlay, HTML to PDF and URL to PDF. Each
 * is one request per run, so a run either makes its one result or fails as a
 * whole. A refusal (400) gets the failure tone, focus on the heading, no
 * receipt, its reason on one row and the way back to the input first, with
 * no retry; a failure another attempt could fix (503) offers "Try again",
 * which sends the request once more. A finished run downloads its result by
 * itself once, never twice, and offers "Download again". Requests are the
 * ones the screens sent before the kit (same endpoint, same form fields).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { downloadBlob, postFormData, processFilesAndDownload, uploadFile } from "@/lib/api";
import { ToolLocationProvider, toolLocation } from "@/skins/experience/tool-location";
import { SplitUI } from "./SplitUI";
import { SplitByTextUI } from "./SplitByTextUI";
import { UnlockUI } from "./UnlockUI";
import { AlternateMixUI } from "./AlternateMixUI";
import { OverlayUI } from "./OverlayUI";
import { HtmlToPdfUI } from "./HtmlToPdfUI";
import { UrlToPdfUI } from "./UrlToPdfUI";

vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(), uploadFile: vi.fn(), postFormData: vi.fn(), processFilesAndDownload: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn(), success: vi.fn() }) }));
// Unlock tries saved passwords in the browser first; with none saved there is nothing to try.
vi.mock("@/hooks/usePdfPasswordTrial", () => ({
    usePdfPasswordTrial: () => ({ state: { status: "idle" }, run: vi.fn(async () => ({ status: "notNeeded" })), reset: vi.fn() }),
}));

const pdf = (name: string) => new File(["%PDF-1.7\n1 0 obj\n"], name, { type: "application/pdf" });
const png = (name = "scan.png") => new File(["\x89PNG"], name, { type: "image/png" });
const httpError = (status: number, message: string) => Object.assign(new Error(message), { __status: status, __detail: message });
const answer = (type = "application/pdf") => ({ blob: async () => new Blob(["out"], { type }), headers: new Headers() }) as Response;

/** What the server answers next, per request; the default is a finished PDF. */
let answers: (() => Promise<Response>)[] = [];
const next = async () => (answers.shift() ?? (async () => answer()))();
/** The form fields every request carried, files by name. */
const sent: { endpoint: string; fields: Record<string, string> }[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    answers = [];
    sent.length = 0;
    localStorage.clear();
    vi.mocked(uploadFile).mockImplementation(async (endpoint, file, params) => {
        sent.push({ endpoint, fields: { file: (file as File).name, ...Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])) } });
        return next();
    });
    vi.mocked(postFormData).mockImplementation(async (endpoint, form) => {
        const body = typeof form === "function" ? form() : form;
        sent.push({ endpoint, fields: Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : (v as File).name])) });
        return next();
    });
    vi.mocked(processFilesAndDownload).mockImplementation(async (endpoint, files, filename, params) => {
        sent.push({ endpoint, fields: { files: files.map(f => f.name).join(","), ...Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])) } });
        const res = await next();
        const blob = await res.blob();
        downloadBlob(blob, filename);
        return { blob, filename };
    });
});
afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const inputs = () => [...document.querySelectorAll<HTMLInputElement>("input[type=file]")];
const choose = (input: HTMLInputElement, files: File[]) => fireEvent.change(input, { target: { files } });

interface Surface {
    name: string;
    path: string;
    ui: () => ReactElement;
    /** Choose the good input (or a refused one) and anything else the run needs, ready to run. */
    prepare: (refused?: boolean) => void;
    run: RegExp;
    /** The success and failure headings, and the action that leads a failure. */
    done: string;
    failed: string;
    lead: string;
    /** What the run downloads by itself, and the request it sends. */
    output: string;
    request: { endpoint: string; fields: Record<string, string> };
}

const surfaces: Surface[] = [
    {
        name: "Split PDF", path: "/tool/split-pdf", ui: () => <SplitUI />, run: /^Split PDF/,
        prepare: refused => choose(inputs()[0], [pdf(refused ? "fake.pdf" : "notes.pdf")]),
        failed: "This PDF couldn’t be split.", lead: "Choose a different file", output: "notes_split.pdf", done: "Your pages are in a new PDF.",
        request: { endpoint: "/split", fields: { file: "notes.pdf", mode: "pages", pages: "1-3" } },
    },
    {
        name: "Split by Text", path: "/tool/split-by-text", ui: () => <SplitByTextUI />, run: /^Split PDF/,
        prepare: refused => { choose(inputs()[0], [pdf(refused ? "fake.pdf" : "notes.pdf")]); fireEvent.change(screen.getByLabelText("Search term"), { target: { value: " Invoice Number " } }); },
        failed: "This PDF couldn’t be split.", lead: "Choose a different file", output: "notes_split.zip", done: "Split at every “Invoice Number”.",
        request: { endpoint: "/split-by-text", fields: { file: "notes.pdf", search: "Invoice Number", case_sensitive: "false" } },
    },
    {
        name: "Unlock PDF", path: "/tool/unlock-pdf", ui: () => <UnlockUI />, run: /^Unlock PDF/,
        prepare: refused => { choose(inputs()[0], [pdf(refused ? "fake.pdf" : "locked.pdf")]); fireEvent.change(screen.getByLabelText("Document password"), { target: { value: "synthetic-pass" } }); },
        failed: "This PDF couldn’t be unlocked.", lead: "Choose a different file", output: "locked_unlocked.pdf", done: "Your PDF is unlocked.",
        request: { endpoint: "/unlock", fields: { files: "locked.pdf", password: "synthetic-pass" } },
    },
    {
        name: "Alternate & Mix", path: "/tool/alternate-mix", ui: () => <AlternateMixUI />, run: /^Mix PDFs/,
        prepare: refused => { choose(inputs()[0], [pdf(refused ? "fake.pdf" : "notes.pdf")]); choose(inputs()[0], [pdf("second.pdf")]); },
        failed: "These PDFs couldn’t be mixed.", lead: "Change the files", output: "notes_alternate_mix.pdf", done: "The pages are interleaved.",
        request: { endpoint: "/alternate-mix", fields: { file1: "notes.pdf", file2: "second.pdf", mode: "alternate" } },
    },
    {
        name: "Overlay", path: "/tool/overlay", ui: () => <OverlayUI />, run: /^Overlay PDFs/,
        prepare: refused => { choose(inputs()[0], [pdf(refused ? "fake.pdf" : "notes.pdf")]); choose(inputs()[0], [pdf("letterhead.pdf")]); },
        failed: "These PDFs couldn’t be combined.", lead: "Change the files", output: "notes_overlay.pdf", done: "Your combined PDF is ready.",
        request: { endpoint: "/overlay", fields: { base_file: "notes.pdf", overlay_file: "letterhead.pdf", mode: "overlay" } },
    },
    {
        name: "HTML to PDF", path: "/tool/html-to-pdf", ui: () => <HtmlToPdfUI />, run: /^Convert to PDF/,
        prepare: refused => fireEvent.change(screen.getByLabelText("Web page URL"), { target: { value: refused ? "http://127.0.0.1/" : " https://www.example.com/a " } }),
        failed: "This page couldn’t be converted.", lead: "Change the address", output: "example.com.pdf", done: "Your PDF is ready.",
        request: { endpoint: "/html-to-pdf", fields: { url: "https://www.example.com/a" } },
    },
    {
        name: "URL to PDF", path: "/tools/url-to-pdf", ui: () => <UrlToPdfUI />, run: /^Convert to PDF/,
        prepare: refused => fireEvent.change(screen.getByLabelText("Webpage URL"), { target: { value: refused ? "http://localhost/" : "example.com/page" } }),
        failed: "This page couldn’t be converted.", lead: "Change the address", output: "example_com.pdf", done: "Your PDF is ready.",
        request: { endpoint: "/url-to-pdf", fields: { url: "https://example.com/page" } },
    },
];

describe.each(surfaces)("$name on the shared kit", surface => {
    beforeEach(() => window.history.pushState({}, "", surface.path));
    const page = () => render(<ToolLocationProvider value={toolLocation({ slug: surface.path.split("/").pop()! })}>{surface.ui()}</ToolLocationProvider>);

    it("runs from the action bar, which says where the input goes, and sends what it sent before the kit", async () => {
        page();
        const bar = document.querySelector(".ts-action-bar")!;
        expect(bar).toHaveAttribute("data-ready", "false");
        surface.prepare();
        expect(bar).toHaveAttribute("data-ready", "true");
        expect(within(bar as HTMLElement).getByText("Temporary server processing")).toBeInTheDocument();
        fireEvent.click(within(bar as HTMLElement).getByRole("button", { name: surface.run }));
        await screen.findByRole("heading", { level: 2, name: surface.done });
        expect(sent).toEqual([surface.request]);
    });

    it("ends a refused run on the failure result: the reason on its row, the way back first, no retry, nothing downloaded", async () => {
        answers.push(async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        const { container } = page();
        surface.prepare(true);
        click(surface.run);
        const heading = await screen.findByRole("heading", { level: 2, name: surface.failed });
        expect(heading).toHaveFocus();
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(screen.queryByText("Ready for what’s next")).toBeNull();
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent(/^Nothing was created\. The reason is below\.$/);
        expect(container.querySelectorAll(".ts-file[data-status=error]")).toHaveLength(1);
        expect(container.querySelector(".ts-file[data-status=error]")).toHaveTextContent("This doesn’t look like a valid PDF.");
        const actions = [...container.querySelectorAll(".ts-actions button")].map(button => button.textContent?.trim());
        expect(actions[0]).toBe(surface.lead);
        expect(screen.queryByRole("button", { name: /^Try( \d+)? again$/ })).toBeNull();
        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it("offers \"Try again\" for a failure another attempt could fix, and sends the request once more", async () => {
        answers.push(async () => { throw httpError(503, "The server is busy. Please try again."); });
        const { container } = page();
        surface.prepare();
        click(surface.run);
        expect(await screen.findByRole("heading", { level: 2, name: surface.failed })).toHaveFocus();
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent("Nothing was created. The server couldn’t finish it.");
        const actions = [...container.querySelectorAll(".ts-actions button")].map(button => button.textContent?.trim());
        expect(actions.slice(0, 2)).toEqual([surface.lead, "Try again"]);
        click("Try again");
        await waitFor(() => expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "success"));
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    });

    it("downloads a finished run once by itself and offers it again", async () => {
        const { container } = page();
        surface.prepare();
        click(surface.run);
        expect(await screen.findByRole("heading", { level: 2, name: surface.done })).toHaveFocus();
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "success");
        expect(screen.getByText("Ready for what’s next")).toBeInTheDocument();
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
        expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe(surface.output);
        expect(container.querySelector(".ts-result-detail")).toHaveTextContent(/The (ZIP )?download has started\.$/);
        // A later render never downloads again: only the visitor's click does.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        click(/^Download (ZIP )?again$/);
        expect(downloadBlob).toHaveBeenCalledTimes(2);
        expect(vi.mocked(downloadBlob).mock.calls[1][1]).toBe(surface.output);
    });

    it("still runs from Ctrl+Enter", async () => {
        page();
        surface.prepare();
        fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
        await screen.findByRole("heading", { level: 2, name: surface.done });
        expect(sent).toHaveLength(1);
    });
});

describe("the file intakes refuse what the tool can't take, in the shared words", () => {
    it.each([
        ["Split PDF", "/tool/split-pdf", () => <SplitUI />, "scan.png wasn’t added. Split PDF takes PDF files. Image to PDF can turn it into a PDF first."],
        ["Unlock PDF", "/tool/unlock-pdf", () => <UnlockUI />, "scan.png wasn’t added. Unlock PDF takes PDF files."],
    ] as const)("%s", (_name, path, ui, words) => {
        window.history.pushState({}, "", path);
        render(ui());
        choose(inputs()[0], [png()]);
        expect(screen.getByRole("alert")).toHaveTextContent(words);
        expect(document.querySelector(".ts-file")).toBeNull();
    });

    it.each([
        ["Alternate & Mix", "/tool/alternate-mix", () => <AlternateMixUI />, "Alternate Mix"],
        ["Overlay", "/tool/overlay", () => <OverlayUI />, "Overlay PDF"],
    ] as const)("%s, in either slot, beside that slot", (_name, path, ui, tool) => {
        window.history.pushState({}, "", path);
        render(ui());
        const slots = () => [...document.querySelectorAll<HTMLElement>(".ts-slot")];
        choose(slots()[1].querySelector("input[type=file]")!, [png()]);
        expect(within(slots()[1]).getByRole("alert")).toHaveTextContent(`scan.png wasn’t added. ${tool} takes PDF files.`);
        expect(within(slots()[0]).queryByRole("alert")).toBeNull();
        choose(slots()[0].querySelector("input[type=file]")!, [png("photo.png")]);
        expect(within(slots()[0]).getByRole("alert")).toHaveTextContent("photo.png wasn’t added.");
    });
});

describe("two named inputs whose order matters", () => {
    it.each([
        ["Alternate & Mix", "/tool/alternate-mix", () => <AlternateMixUI />, "Swap A and B", /^Mix PDFs/, ["file1", "file2"], ["First PDF (A)", "Second PDF (B)"]],
        ["Overlay", "/tool/overlay", () => <OverlayUI />, "Swap base and overlay", /^Overlay PDFs/, ["base_file", "overlay_file"], ["Base PDF (A)", "Overlay PDF (B)"]],
    ] as const)("%s labels each slot with its role and swaps the two, which swaps what is sent", async (_name, path, ui, swap, run, fields, roles) => {
        window.history.pushState({}, "", path);
        render(ui());
        expect(screen.getAllByRole("heading", { level: 2 }).slice(0, 2).map(heading => heading.textContent)).toEqual(roles);
        choose(inputs()[0], [pdf("one.pdf")]);
        choose(inputs()[0], [pdf("two.pdf")]);
        click(swap);
        click(run);
        await waitFor(() => expect(document.querySelector(".ts-result")).not.toBeNull());
        expect(sent[0].fields[fields[0]]).toBe("two.pdf");
        expect(sent[0].fields[fields[1]]).toBe("one.pdf");
    });

    it("goes back to both files, kept, after a refusal, to change the one that was refused", async () => {
        answers.push(async () => { throw httpError(400, "File does not appear to be a PDF."); });
        window.history.pushState({}, "", "/tool/overlay");
        render(<OverlayUI />);
        choose(inputs()[0], [pdf("fake.pdf")]);
        choose(inputs()[0], [pdf("letterhead.pdf")]);
        click(/^Overlay PDFs/);
        expect(await screen.findByText("fake.pdf and letterhead.pdf")).toBeInTheDocument();
        click("Change the files");
        expect(screen.getByRole("heading", { level: 2, name: "Base PDF (A)" })).toHaveFocus();
        expect(screen.getByText("fake.pdf")).toBeInTheDocument();
        expect(screen.getByText("letterhead.pdf")).toBeInTheDocument();
    });
});

describe("going back from a result", () => {
    it("Split PDF: \"Change the split\" keeps the file and the ranges, and puts focus on the ranges", async () => {
        answers.push(async () => { throw httpError(400, "Page 9 is out of range (this PDF has 6 pages)."); });
        render(<SplitUI />);
        choose(inputs()[0], [pdf("notes.pdf")]);
        fireEvent.change(screen.getByLabelText("Page ranges"), { target: { value: "9" } });
        click(/^Split PDF/);
        await screen.findByRole("heading", { level: 2, name: "This PDF couldn’t be split." });
        click("Change the split");
        expect(screen.getByLabelText("Page ranges")).toHaveFocus();
        expect(screen.getByLabelText("Page ranges")).toHaveValue("9");
        expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    });

    it("Split PDF: a different file chosen from the failure is the file to split, with focus on the run button", async () => {
        answers.push(async () => { throw httpError(400, "This doesn’t look like a valid PDF."); });
        render(<SplitUI />);
        choose(inputs()[0], [pdf("fake.pdf")]);
        click(/^Split PDF/);
        await screen.findByRole("heading", { level: 2, name: "This PDF couldn’t be split." });
        choose(inputs()[0], [pdf("notes.pdf")]);
        expect(screen.getByText("notes.pdf")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Split PDF/ })).toHaveFocus();
    });

    it("Split by Text: \"Change the search text\" keeps the PDF and the words, with focus on the words", async () => {
        answers.push(async () => { throw httpError(400, "Search term 'Invoice' not found in any page"); });
        render(<SplitByTextUI />);
        choose(inputs()[0], [pdf("notes.pdf")]);
        fireEvent.change(screen.getByLabelText("Search term"), { target: { value: "Invoice" } });
        click(/^Split PDF/);
        expect(await screen.findByText("Search term 'Invoice' not found in any page")).toBeInTheDocument();
        click("Change the search text");
        expect(screen.getByLabelText("Search term")).toHaveFocus();
        expect(screen.getByLabelText("Search term")).toHaveValue("Invoice");
    });

    it("Unlock PDF: \"Try another password\" keeps the PDFs and selects the password to retype", async () => {
        answers.push(async () => { throw httpError(400, "Incorrect password. Please provide the correct password to unlock this PDF."); });
        render(<UnlockUI />);
        choose(inputs()[0], [pdf("locked.pdf"), pdf("locked2.pdf")]);
        fireEvent.change(screen.getByLabelText("Document password"), { target: { value: "wrong" } });
        click(/^Unlock 2 PDFs/);
        expect(await screen.findByRole("heading", { level: 2, name: "None of these PDFs could be unlocked." })).toHaveFocus();
        expect(screen.getByText("2 PDFs, uploaded together")).toBeInTheDocument();
        click("Try another password");
        const field = screen.getByLabelText("Document password") as HTMLInputElement;
        expect(field).toHaveFocus();
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
        expect(screen.getAllByText(/^locked2?\.pdf$/)).toHaveLength(2);
    });

    it("Unlock PDF: several PDFs unlocked together download as one ZIP, offered again as a ZIP", async () => {
        render(<UnlockUI />);
        choose(inputs()[0], [pdf("locked.pdf"), pdf("locked2.pdf")]);
        fireEvent.change(screen.getByLabelText("Document password"), { target: { value: "synthetic-pass" } });
        click(/^Unlock 2 PDFs/);
        expect(await screen.findByRole("heading", { level: 2, name: "2 PDFs unlocked." })).toHaveFocus();
        expect(sent[0].fields.files).toBe("locked.pdf,locked2.pdf");
        expect(vi.mocked(processFilesAndDownload).mock.calls[0][2]).toBe("locked_unlocked.zip");
        expect(downloadBlob).toHaveBeenCalledTimes(1);
        click("Download ZIP again");
        expect(downloadBlob).toHaveBeenCalledTimes(2);
    });

    it("URL to PDF: \"Change the address\" keeps the address, with focus on it", async () => {
        answers.push(async () => { throw httpError(400, "Local/internal URLs are not allowed"); });
        render(<UrlToPdfUI />);
        fireEvent.change(screen.getByLabelText("Webpage URL"), { target: { value: "http://localhost/" } });
        click(/^Convert to PDF/);
        expect(await screen.findByText("Local/internal URLs are not allowed")).toBeInTheDocument();
        expect(screen.getByText("http://localhost/")).toBeInTheDocument();
        click("Change the address");
        expect(screen.getByLabelText("Webpage URL")).toHaveFocus();
        expect(screen.getByLabelText("Webpage URL")).toHaveValue("http://localhost/");
    });

    it("URL to PDF: an address the page can't send is said beside the field, and nothing is sent", () => {
        render(<UrlToPdfUI />);
        fireEvent.change(screen.getByLabelText("Webpage URL"), { target: { value: "ftp://example.com" } });
        click(/^Convert to PDF/);
        expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid URL (e.g. https://example.com)");
        expect(screen.getByLabelText("Webpage URL")).toHaveAttribute("aria-invalid", "true");
        expect(sent).toEqual([]);
        expect(document.querySelector(".ts-result")).toBeNull();
    });

    it("HTML to PDF: pasted HTML is sent as it is, and \"Edit the HTML\" brings it back after a refusal", async () => {
        answers.push(async () => { throw httpError(413, "HTML content exceeds 2 MB limit"); });
        render(<HtmlToPdfUI />);
        click("From HTML");
        fireEvent.change(screen.getByLabelText("HTML content"), { target: { value: "<h1>Hello</h1>\n" } });
        click(/^Convert to PDF/);
        expect(await screen.findByRole("heading", { level: 2, name: "This HTML couldn’t be converted." })).toHaveFocus();
        expect(sent[0]).toEqual({ endpoint: "/html-to-pdf", fields: { html_content: "<h1>Hello</h1>\n" } });
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        click("Edit the HTML");
        expect(screen.getByLabelText("HTML content")).toHaveFocus();
        expect(screen.getByLabelText("HTML content")).toHaveValue("<h1>Hello</h1>\n");
    });
});
