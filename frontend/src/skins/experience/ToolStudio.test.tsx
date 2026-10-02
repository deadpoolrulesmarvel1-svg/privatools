import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FileIntake, StudioActions, StudioResult } from "./ToolStudio";

afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

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

    it.each(["Enter", " "])("opens the chooser from the keyboard with %j, once", key => {
        const { container } = render(<FileIntake accepts=".pdf" title="Pick" onFiles={vi.fn()} />);
        const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
        const click = vi.spyOn(input, "click").mockImplementation(() => {});
        fireEvent.keyDown(screen.getByRole("button", { name: /^Choose a file/ }), { key });
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
});

describe("StudioResult", () => {
    it("moves focus to its heading when it appears", () => {
        render(<StudioResult title="A little lighter. 60% smaller."><p>receipt</p></StudioResult>);
        const heading = screen.getByRole("heading", { name: "A little lighter. 60% smaller." });
        expect(heading).toHaveFocus();
        expect(heading).toHaveAttribute("tabindex", "-1");
        expect(screen.getByText("Ready for what’s next")).toBeInTheDocument();
    });

    it("never dresses a failure as success", () => {
        const { container } = render(<StudioResult tone="failure" title="This PDF couldn’t be compressed." />);
        expect(container.querySelector(".ts-result")).toHaveAttribute("data-tone", "failure");
        expect(screen.queryByText("Ready for what’s next")).toBeNull();
        expect(container.querySelector(".lucide-check")).toBeNull();
        expect(container.querySelector(".lucide-triangle-alert, .lucide-alert-triangle")).not.toBeNull();
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
