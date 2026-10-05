/**
 * Word to PDF sets each paragraph's text and leaves out every Word equation
 * (python-docx's paragraph text has none). The server says how many in
 * X-Equations-Left-Out, and the result names the count on the file's row with
 * a link to the tool that keeps them. The API is stubbed; the files are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { uploadFileWithProgress } from "@/lib/api";
import { RepairUI, WordToPdfUI } from "./SimpleConvertUI";

vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(), uploadFileWithProgress: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));

const docx = (name: string) => new File(["synthetic docx"], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const answer = (equations: string | null) => ({
    blob: async () => new Blob(["%PDF-1.4 synthetic"], { type: "application/pdf" }),
    headers: new Headers(equations === null ? {} : { "X-Equations-Left-Out": equations }),
}) as Response;

beforeEach(() => { vi.clearAllMocks(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);

function convert(name: string) {
    const { container } = render(<WordToPdfUI />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [docx(name)] } });
    fireEvent.click(screen.getByRole("button", { name: /^Convert to PDF/ }));
}

describe("Word to PDF's equations", () => {
    it.each([
        ["2", "2 equations were left out. Office to PDF keeps them."],
        ["1", "1 equation was left out. Office to PDF keeps it."],
    ])("says on the file's row when %s were left out, and links the tool that keeps them", async (count, note) => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(answer(count));
        convert("maths.docx");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === note)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Office to PDF" })).toHaveAttribute("href", "/tool/office-to-pdf");
    });

    it.each([["0"], [null]])("says nothing about equations when the answer counts %s", async count => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(answer(count));
        convert("plain.docx");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        expect(screen.queryByText(/equation/)).toBeNull();
    });
});

/**
 * Repair PDF saves the pages of a PDF cut short that survive, and the server
 * says how many of how many in X-Repair-Pages ("4/6"). The result says it on
 * the file's row, so a visitor does not take the file for the whole document.
 */
describe("Repair PDF's pages saved", () => {
    const pdf = (name: string) => new File(["%PDF-1.7 synthetic"], name, { type: "application/pdf" });
    const repaired = (pages: string | null) => ({
        blob: async () => new Blob(["%PDF-1.4 synthetic"], { type: "application/pdf" }),
        headers: new Headers(pages === null ? {} : { "X-Repair-Pages": pages }),
    }) as Response;

    function repair(name: string) {
        const { container } = render(<RepairUI />);
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pdf(name)] } });
        fireEvent.click(screen.getByRole("button", { name: /^Repair PDF/ }));
    }

    it.each([
        ["4/6", "4 of its 6 pages were saved. The other 2 could not be read."],
        ["5/6", "5 of its 6 pages were saved. The other page could not be read."],
        ["1/3", "1 of its 3 pages was saved. The other 2 could not be read."],
        // Thousands as the refusals write them ("only 1 of its 1,200 pages").
        ["1199/1200", "1,199 of its 1,200 pages were saved. The other page could not be read."],
        ["1/1200", "1 of its 1,200 pages was saved. The other 1,199 could not be read."],
    ])("says on the file's row how many pages were saved when the answer is %s", async (pages, note) => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(repaired(pages));
        repair("download.pdf");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === note)).toBeInTheDocument();
    });

    it.each([["6/6"], [null], ["garbage"]])("says nothing about pages when the answer is %s", async pages => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(repaired(pages));
        repair("whole.pdf");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        expect(screen.queryByText(/pages? (was|were) saved/)).toBeNull();
    });
});
