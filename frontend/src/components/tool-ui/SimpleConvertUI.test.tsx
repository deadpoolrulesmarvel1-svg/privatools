/**
 * Word to PDF sets each paragraph's text and leaves out every Word equation
 * (python-docx's paragraph text has none). The server says how many in
 * X-Equations-Left-Out, and the result names the count on the file's row with
 * the tool that keeps them. The API is stubbed; the files are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { uploadFileWithProgress } from "@/lib/api";
import { WordToPdfUI } from "./SimpleConvertUI";

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
    ])("says on the file's row when %s were left out", async (count, note) => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(answer(count));
        convert("maths.docx");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        // The row reads "<size> · <note>".
        expect(screen.getByText(text => text.endsWith(` · ${note}`))).toBeInTheDocument();
    });

    it.each([["0"], [null]])("says nothing about equations when the answer counts %s", async count => {
        vi.mocked(uploadFileWithProgress).mockResolvedValue(answer(count));
        convert("plain.docx");
        await screen.findByRole("heading", { name: "Your conversion is ready." });
        expect(screen.queryByText(/equation/)).toBeNull();
    });
});
