/**
 * A Bates matter keeps one sequence across documents and sessions: a stamp
 * the server confirmed moves the matter's next number on by the pages it
 * numbered, so the next document continues where this one stopped. The matter
 * lives in the real local store (fake IndexedDB, as in every test here); the
 * API and the page count are stubbed, and the files are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { uploadFile, uploadFiles } from "@/lib/api";
import { countPdfPages } from "@/lib/pdfMeta";
import * as counters from "@/lib/localStore/counters";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BatesUI } from "./BatesUI";

vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(), uploadFile: vi.fn(), uploadFiles: vi.fn(), downloadBlob: vi.fn(),
}));
// Three pages a file, as pdf.js would count them.
vi.mock("@/lib/pdfMeta", () => ({ countPdfPages: vi.fn(async (files: File[]) => files.length * 3) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn(), success: vi.fn() }) }));

const pdf = (name: string) => new File(["%PDF-1.4 synthetic"], name, { type: "application/pdf" });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);

async function openWithMatter(name: string) {
    const matter = await counters.createCounter({ name, prefix: "SYN-", next: 101 });
    await counters.setActiveCounterId(matter.id);
    const { container } = render(<TooltipProvider><BatesUI /></TooltipProvider>);
    // The active matter seeds the form: its prefix and its next number.
    await screen.findByText("SYN-000101", { selector: ".ts-sample" });
    return { matter, container };
}

function stamp(container: HTMLElement, files: File[]) {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: /^Stamp (PDF|\d+ PDFs)/ }));
}

describe("Bates Numbering's matter", () => {
    it("continues after the pages one stamped file holds", async () => {
        vi.mocked(uploadFile).mockResolvedValue({ blob: async () => new Blob(["%PDF stamped"]), headers: new Headers() } as Response);
        const { matter, container } = await openWithMatter("Synthetic v. Example");
        stamp(container, [pdf("exhibit.pdf")]);
        expect(await screen.findByText(/Synthetic v\. Example continues at SYN-000104 next time\./)).toBeInTheDocument();
        expect((await counters.getCounter(matter.id))?.next).toBe(104);
        expect(vi.mocked(countPdfPages).mock.calls[0][0].map(file => file.name)).toEqual(["exhibit.pdf"]);
    });

    it("leaves the matter where it was when the file could not be stamped", async () => {
        vi.mocked(uploadFile).mockRejectedValue(Object.assign(new Error("This PDF appears to be corrupt or invalid."), { __status: 400 }));
        const { matter, container } = await openWithMatter("Refused v. Example");
        stamp(container, [pdf("broken.pdf")]);
        await screen.findByRole("heading", { name: /couldn’t be numbered/ });
        expect((await counters.getCounter(matter.id))?.next).toBe(101);
        expect(screen.queryByText(/continues at/)).toBeNull();
    });

    it("continues after the pages a production set holds, as its manifest counts them", async () => {
        const manifest = [
            { index: 0, pages: 2, firstBates: "SYN-000101", lastBates: "SYN-000102", file: "one.pdf" },
            { index: 1, pages: 3, firstBates: "SYN-000103", lastBates: "SYN-000105", file: "two.pdf" },
        ];
        vi.mocked(uploadFiles).mockResolvedValue({
            blob: async () => new Blob(["PK synthetic"]), headers: new Headers({ "X-Bates-Manifest": JSON.stringify(manifest) }),
        } as Response);
        const { matter, container } = await openWithMatter("Production v. Example");
        stamp(container, [pdf("one.pdf"), pdf("two.pdf")]);
        expect(await screen.findByText(/Production v\. Example continues at SYN-000106 next time\./)).toBeInTheDocument();
        expect((await counters.getCounter(matter.id))?.next).toBe(106);
    });

    it("leaves the matter where it was when the production set could not be numbered", async () => {
        vi.mocked(uploadFiles).mockRejectedValue(Object.assign(new Error("'two.pdf' is not a PDF"), { __status: 400 }));
        const { matter, container } = await openWithMatter("Refused set v. Example");
        stamp(container, [pdf("one.pdf"), pdf("two.pdf")]);
        await screen.findByRole("heading", { name: "None of these PDFs could be numbered." });
        expect((await counters.getCounter(matter.id))?.next).toBe(101);
    });
});
