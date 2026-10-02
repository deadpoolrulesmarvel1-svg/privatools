import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { FileChooserButton, FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioResult } from "./ToolStudio";
import { fileCount } from "./file-format-label";
import { ToolLocationProvider, toolLocation } from "./tool-location";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

afterEach(() => { cleanup(); vi.mocked(toast.error).mockClear(); window.history.pushState({}, "", "/"); });

const png = () => new File(["png"], "holiday.png", { type: "image/png" });
const pdf = (name = "report.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
function drop(target: Element, files: File[]) {
    fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

describe("FileIntake", () => {
    it("names its one button by the visible call to action first (WCAG 2.5.3)", () => {
        render(<FileIntake accepts=".pdf" multiple label="Upload files" title="Make a little more room." detail="Choose PDFs to compress" onFiles={vi.fn()} />);
        const button = screen.getByRole("button", { name: "Choose files: Make a little more room." });
        expect(button).toHaveTextContent(/^Choose files$/);
        expect(button).toHaveAccessibleDescription("Choose PDFs to compress");
    });

    it("gives paired intakes distinct names and a compact intake its short name", () => {
        render(<>
            <FileIntake accepts=".pdf" title="Original PDF" onFiles={vi.fn()} />
            <FileIntake accepts=".pdf" title="Modified PDF" onFiles={vi.fn()} />
            <FileIntake accepts=".pdf" multiple compact onFiles={vi.fn()} />
        </>);
        expect(screen.getByRole("button", { name: "Choose a file: Original PDF" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Choose a file: Modified PDF" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add files" })).toBeInTheDocument();
    });

    // The button's own activation (user-event runs the browser's default for Enter and Space)
    // reaches the card's click handler: no key handler of its own, so no second route.
    it.each(["{Enter}", " "])("opens the chooser from the keyboard with %j, once", async key => {
        const user = userEvent.setup();
        const { container } = render(<FileIntake accepts=".pdf" title="Pick" onFiles={vi.fn()} />);
        const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
        const click = vi.spyOn(input, "click").mockImplementation(() => {});
        screen.getByRole("button", { name: /^Choose a file/ }).focus();
        await user.keyboard(key);
        expect(click).toHaveBeenCalledTimes(1);
    });

    it("refuses a dropped file of the wrong type by name, points to the tool that takes it, and passes the rest", () => {
        window.history.pushState({}, "", "/tool/compress-pdf");
        const onFiles = vi.fn();
        const { container } = render(<FileIntake accepts=".pdf" multiple title="Make a little more room." onFiles={onFiles} />);
        const report = pdf();
        drop(container.querySelector(".ts-intake")!, [report, png()]);
        expect(onFiles).toHaveBeenCalledWith([report]);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("holiday.png wasn’t added. Compress PDF takes PDF files. Try Image Compressor for PNG files.");
        expect(within(alert).getByRole("link", { name: "Image Compressor" })).toHaveAttribute("href", "/tools/image-compressor");
        // The next good selection clears the notice.
        drop(container.querySelector(".ts-intake")!, [pdf("second.pdf")]);
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("refuses a chosen file the same way, and passes nothing on when nothing fits", () => {
        const onFiles = vi.fn();
        const { container } = render(<FileIntake accepts=".pdf" title="Pick" onFiles={onFiles} />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [png()] } });
        expect(onFiles).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("holiday.png wasn’t added.");
        fireEvent.click(screen.getByRole("button", { name: "Dismiss this message" }));
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("focuses its button when asked, for a return from a result", () => {
        render(<FileIntake accepts=".pdf" multiple compact autoFocus onFiles={vi.fn()} />);
        expect(screen.getByRole("button", { name: "Add files" })).toHaveFocus();
    });

    it("heads the page's first step with an h2 and opens the chooser from a folder, not an external-link arrow", () => {
        render(<FileIntake accepts=".pdf" multiple title="Make a little more room." onFiles={vi.fn()} />);
        expect(screen.getByRole("heading", { level: 2, name: "Make a little more room." })).toBeInTheDocument();
        const choose = screen.getByRole("button", { name: /^Choose files/ });
        expect(choose.querySelector(".lucide-folder-open")).not.toBeNull();
        expect(choose.querySelector(".lucide-arrow-up-right")).toBeNull();
        // No eyebrow over the heading.
        expect(screen.queryByText("Start with your file")).toBeNull();
    });

    it("shrinks to a quiet \"Add files\" text button once files are chosen", () => {
        render(<FileIntake accepts=".pdf" multiple compact onFiles={vi.fn()} />);
        const add = screen.getByRole("button", { name: "Add files" });
        expect(add.querySelector(".lucide-plus")).not.toBeNull();
        expect(add.querySelector(".lucide-arrow-up-right")).toBeNull();
        expect(screen.queryByText(/Temporary server processing/)).toBeNull();
    });

    it("says where the file goes on a tool page, in the page's own words, and nothing elsewhere", () => {
        const { rerender } = render(<FileIntake accepts=".pdf" title="Pick" onFiles={vi.fn()} />);
        expect(document.querySelector(".tool-where")).toBeNull();
        rerender(<ToolLocationProvider value={toolLocation({ slug: "compress-pdf" })}><FileIntake accepts=".pdf" title="Pick" onFiles={vi.fn()} /></ToolLocationProvider>);
        expect(document.querySelector(".ts-intake .tool-where")).toHaveTextContent("Temporary server processing. Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.");
        rerender(<ToolLocationProvider value={toolLocation({ slug: "json-xml-formatter", clientOnly: true })}><FileIntake accepts=".json" title="Pick" onFiles={vi.fn()} /></ToolLocationProvider>);
        expect(document.querySelector(".ts-intake .tool-where")).toHaveTextContent(/^Stays on your device\. Processing happens in this browser\. Your input stays on this device\./);
        rerender(<ToolLocationProvider value={toolLocation({ slug: "summarize-pdf", clientOnly: true, byok: true })}><FileIntake accepts=".pdf" title="Pick" onFiles={vi.fn()} /></ToolLocationProvider>);
        expect(document.querySelector(".ts-intake .tool-where")).toHaveTextContent(/^This device or your AI key\. Choose where the model runs before summarizing\./);
    });
});

describe("StudioLayout and the action bar", () => {
    it("keeps one order: the intake, the options, then the action bar", () => {
        render(<ToolLocationProvider value={toolLocation({ slug: "compress-pdf" })}>
            <StudioLayout options={<h2>How small?</h2>} action={<StudioActionBar ready count={fileCount(1, "PDF")}><button>Compress PDF</button></StudioActionBar>}>
                <FileIntake accepts=".pdf" multiple compact onFiles={vi.fn()} />
            </StudioLayout>
        </ToolLocationProvider>);
        const order = [...document.querySelectorAll(".ts-intake, .ts-options, .ts-action-bar")].map(element => element.className.split(" ")[0]);
        expect(order).toEqual(["ts-intake", "ts-options", "ts-action-bar"]);
        const bar = document.querySelector(".ts-action-bar")!;
        expect(bar).toHaveAttribute("data-ready", "true");
        expect(bar).toHaveTextContent("1 PDFTemporary server processingCompress PDF");
        // The bar names the count and where the files go before its button, for screen readers too.
        expect(within(bar as HTMLElement).getByText("1 PDF").compareDocumentPosition(screen.getByRole("button", { name: "Compress PDF" }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("waits to stick until there is something to run", () => {
        render(<StudioActionBar ready={false}><button disabled>Compress PDF</button></StudioActionBar>);
        expect(document.querySelector(".ts-action-bar")).toHaveAttribute("data-ready", "false");
        expect(document.querySelector(".ts-action-status")).toBeNull();
    });

    it("counts files in the visitor's words", () => {
        expect(fileCount(1, "PDF")).toBe("1 PDF");
        expect(fileCount(3, "PDF")).toBe("3 PDFs");
        expect(fileCount(2)).toBe("2 files");
        expect(fileCount(1, "audio file")).toBe("1 audio file");
        expect(fileCount(4, "PDF", "PDFs")).toBe("4 PDFs");
    });
});

describe("StudioFile", () => {
    it("names a file as a label in its row, not as a heading that would break the page's outline", () => {
        render(<StudioFile name="report.pdf" detail="1 MB" />);
        expect(screen.queryByRole("heading")).toBeNull();
        expect(screen.getByText("report.pdf")).toHaveClass("ts-file-name");
    });
});

describe("StudioResult", () => {
    it("moves focus to its heading when it appears", () => {
        render(<StudioResult title="A little lighter. 60% smaller."><p>receipt</p></StudioResult>);
        const heading = screen.getByRole("heading", { name: "A little lighter. 60% smaller." });
        expect(heading).toHaveFocus();
        expect(heading).toHaveAttribute("tabindex", "-1");
        expect(screen.getByText("Ready for what’s next")).toBeInTheDocument();
    });

    it("leaves focus where the visitor put it: a field in an open dialog keeps it when the result appears", () => {
        function Page() {
            const [done, setDone] = useState(false);
            return <>
                <div role="dialog" aria-modal="true" aria-label="Search tools and pages"><input aria-label="Search" /></div>
                <button onClick={() => setDone(true)}>finish run</button>
                {done && <StudioResult title="A little lighter. 60% smaller." />}
            </>;
        }
        render(<Page />);
        const field = screen.getByRole("textbox", { name: "Search" });
        const finish = screen.getByRole("button", { name: "finish run" });
        field.focus();
        act(() => { finish.click(); });
        expect(screen.getByRole("heading", { name: "A little lighter. 60% smaller." })).not.toHaveFocus();
        expect(field).toHaveFocus();
    });

    it("never dresses a failure as success", () => {
        const { container } = render(<StudioResult tone="failure" title="This PDF couldn’t be compressed." />);
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(screen.queryByText("Ready for what’s next")).toBeNull();
        expect(container.querySelector(".lucide-check")).toBeNull();
        expect(container.querySelector(".lucide-triangle-alert, .lucide-alert-triangle")).not.toBeNull();
    });
});

describe("FileChooserButton", () => {
    it("names the refused part of a mixed choice in a toast when the result it sat on gives way", () => {
        window.history.pushState({}, "", "/tool/compress-pdf");
        const report = pdf("notes.pdf");
        function Result() {
            const [chosen, setChosen] = useState<File[] | null>(null);
            // Like every result: accepted files reset the tool, so the chooser and its notice unmount at once.
            return chosen ? <p>Form with {chosen.map(file => file.name).join(", ")}</p>
                : <FileChooserButton accepts=".pdf" multiple onFiles={setChosen}>Choose a different file</FileChooserButton>;
        }
        const { container } = render(<Result />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [report, png()] } });
        expect(screen.getByText("Form with notes.pdf")).toBeInTheDocument();
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.error).mock.calls[0][0]).toBe("holiday.png wasn’t added.");
        expect(vi.mocked(toast.error).mock.calls[0][1]).toMatchObject({ description: "Compress PDF takes PDF files. Try Image Compressor for PNG files." });
    });

    it("says nothing, rather than name another tool, when the visitor has moved to another page", () => {
        window.history.pushState({}, "", "/tool/compress-pdf");
        const onFiles = vi.fn();
        // The chooser stays on the page after the mixed choice; the visitor then follows a link.
        const { container } = render(<FileChooserButton accepts=".pdf" multiple onFiles={onFiles}>Choose a different file</FileChooserButton>);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf("notes.pdf"), png()] } });
        expect(onFiles).toHaveBeenCalledTimes(1);
        window.history.pushState({}, "", "/tool/merge-pdf");
        cleanup();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("keeps a refusal beside the button, with no toast, when nothing was accepted", () => {
        const onFiles = vi.fn();
        const { container } = render(<FileChooserButton accepts=".pdf" onFiles={onFiles}>Choose a different file</FileChooserButton>);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [png()] } });
        expect(onFiles).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("holiday.png wasn’t added.");
        cleanup();
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe("StudioActions", () => {
    const actions = (tone: "success" | "partial" | "failure", retryCount: number, onRetry = vi.fn()) => render(<StudioActions tone={tone} retryCount={retryCount} onRetry={onRetry}
        choose={{ accepts: ".pdf", onFiles: vi.fn() }} primary={<button>Download again</button>} more={<button>Compress more</button>} />);

    it("leads a failure with a different file and offers no retry for a file the tool refused", () => {
        actions("failure", 0);
        const buttons = screen.getAllByRole("button").map(button => button.textContent);
        expect(buttons).toEqual(["Choose a different file", "Compress more"]);
    });

    it("offers \"Try again\" only for failures another attempt could fix", () => {
        const onRetry = vi.fn();
        actions("failure", 2, onRetry);
        fireEvent.click(screen.getByRole("button", { name: "Try 2 again" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        cleanup();
        actions("partial", 1);
        expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Download again", "Try again", "Compress more"]);
    });
});
