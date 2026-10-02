import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CompressUI } from "./CompressUI";
import { uploadFile } from "@/lib/api";

vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), uploadFile: vi.fn(), downloadBlob: vi.fn() }));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/hooks/useFirstSuccess", () => ({ emitToolSuccess: vi.fn() }));
vi.mock("./ResultHandoff", () => ({ ResultHandoff: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

const pdf = (name: string) => new File(["%PDF-1.7 synthetic"], name, { type: "application/pdf" });
/** The shape lib/api.ts gives a refused upload: the server's words and the status. */
const httpError = (status: number, message: string) => Object.assign(new Error(message), { __status: status });
const compressed = () => new Response(new Blob(["%PDF-small"]), { headers: { "X-Compressed-Size": "10" } });

function choose(container: HTMLElement, files: File[]) {
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files } });
}
async function run() {
    fireEvent.click(screen.getByRole("button", { name: /^Compress (PDF|\d+ PDFs)$/ }));
}
const actionLabels = (result: HTMLElement) => within(result.querySelector(".ts-actions") as HTMLElement).getAllByRole("button").map(button => button.textContent?.trim());

beforeEach(() => { localStorage.clear(); vi.mocked(uploadFile).mockReset(); });
afterEach(cleanup);

describe("Compress PDF results", () => {
    it("ends a refused file on a failure, never a success: the reason, no receipt, a different file first, no retry", async () => {
        vi.mocked(uploadFile).mockRejectedValue(httpError(400, "File does not appear to be a PDF. Convert it to PDF first."));
        const { container } = render(<CompressUI />);
        choose(container, [pdf("not-really-a.pdf")]);
        await run();
        const heading = await screen.findByRole("heading", { name: "This PDF couldn’t be compressed." });
        expect(heading).toHaveFocus();
        const result = container.querySelector<HTMLElement>(".ts-result")!;
        expect(result).toHaveAttribute("data-tone", "failure");
        expect(within(result).getByText("File does not appear to be a PDF. Convert it to PDF first.")).toBeInTheDocument();
        expect(within(result).queryByText("Before")).toBeNull();
        expect(within(result).queryByText("Ready for what’s next")).toBeNull();
        expect(actionLabels(result)).toEqual(["Choose a different file"]);
    });

    it("offers \"Try again\" after a server fault, and a retry sends only that file again", async () => {
        vi.mocked(uploadFile).mockRejectedValueOnce(httpError(503, "The server isn't responding right now. Try again in a moment."));
        const { container } = render(<CompressUI />);
        choose(container, [pdf("quarterly.pdf")]);
        await run();
        await screen.findByRole("heading", { name: "This PDF couldn’t be compressed." });
        const result = container.querySelector<HTMLElement>(".ts-result")!;
        expect(actionLabels(result)).toEqual(["Choose a different file", "Try again"]);
        vi.mocked(uploadFile).mockResolvedValueOnce(compressed());
        fireEvent.click(within(result).getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("heading", { name: /^A little lighter|^Your PDF is ready/ })).toBeInTheDocument();
        expect(uploadFile).toHaveBeenCalledTimes(2);
    });

    it("shows a partial success as both parts: the receipt for what worked, the reason for what didn't", async () => {
        vi.mocked(uploadFile).mockImplementation(async (_endpoint, file) => {
            if (file.name === "broken.pdf") throw httpError(400, "File does not appear to be a PDF. Convert it to PDF first.");
            return compressed();
        });
        const { container } = render(<CompressUI />);
        choose(container, [pdf("quarterly.pdf"), pdf("broken.pdf")]);
        await run();
        await screen.findByRole("heading", { name: "1 of 2 PDFs compressed." });
        const result = container.querySelector<HTMLElement>(".ts-result")!;
        expect(result).toHaveAttribute("data-tone", "partial");
        expect(within(result).getByText("Before")).toBeInTheDocument();
        expect(within(result).getByText(/One file couldn’t be compressed; the reason is below/)).toBeInTheDocument();
        expect(within(result).getByText("File does not appear to be a PDF. Convert it to PDF first.")).toBeInTheDocument();
        expect(actionLabels(result)).toEqual(["Download again", "Compress more"]);
    });

    it("names a dropped file that isn't a PDF and points to the tool that takes it", () => {
        window.history.pushState({}, "", "/tool/compress-pdf");
        const { container } = render(<CompressUI />);
        fireEvent.drop(container.querySelector(".ts-intake")!, { dataTransfer: { files: [new File(["png"], "holiday.png", { type: "image/png" })] } });
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("holiday.png wasn’t added. Compress PDF takes PDF files. Try Image Compressor for PNG files.");
        expect(within(alert).getByRole("link", { name: "Image Compressor" })).toHaveAttribute("href", "/tools/image-compressor");
        window.history.pushState({}, "", "/");
    });
});
