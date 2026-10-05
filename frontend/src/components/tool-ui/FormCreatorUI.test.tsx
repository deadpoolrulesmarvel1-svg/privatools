/**
 * Form Creator's "Detect fields": proposals are shown apart from placed
 * fields, the visitor accepts, edits or rejects each, and only accepted
 * fields reach /form-creator. The page stage is replaced by a list of its
 * regions, so the test can see what it would draw and click it; the network
 * calls are stubbed with answers in the route's shape.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAndDownload, uploadFileGetJson } from "@/lib/api";
import { FormCreatorUI } from "./FormCreatorUI";
import type { DetectReport } from "./form-detect";

type Region = { id: string; page: number; x: number; y: number; width: number; height: number; kind?: string; label?: string };
vi.mock("./pdf/PdfPageStage", () => ({
    PdfPageStage: ({ regions = [], onSelect }: { regions?: Region[]; onSelect?: (id: string) => void }) => (
        <ul aria-label="Page regions">
            {regions.map(r => <li key={r.id}><button type="button" data-kind={r.kind || "placed"} onClick={() => onSelect?.(r.id)}>{r.label}</button></li>)}
        </ul>
    ),
}));
vi.mock("@/lib/api", async original => ({
    ...await original<typeof import("@/lib/api")>(),
    uploadFileGetJson: vi.fn(),
    processAndDownload: vi.fn(async () => ({})),
}));

const candidate = (id: string, name: string, type: "text" | "checkbox" | "signature" | "date", y: number, extra = {}) => ({
    id, page: 1, x: 120, y, width: 300, height: 17, type, name, label: `${name.replace(/_/g, " ")}:`, confidence: 0.9, multiline: false, ...extra,
});
const REPORT: DetectReport = {
    pages: 1,
    candidates: [
        candidate("c1", "full_name", "text", 100),
        candidate("c2", "date_of_birth", "date", 140),
        candidate("c3", "smoker_yes", "checkbox", 180, { width: 10, height: 10, confidence: 0.6, label: "Yes" }),
        candidate("c4", "signature", "signature", 220),
    ],
    truncated: false, scanPages: [], complexPages: [], pagesNotChecked: [], existingFields: 0,
};

const pdf = new File(["%PDF-1.7 synthetic"], "membership.pdf", { type: "application/pdf" });

beforeEach(() => {
    vi.mocked(uploadFileGetJson).mockReset();
    vi.mocked(processAndDownload).mockClear();
});
afterEach(cleanup);

async function detect(report: DetectReport = REPORT) {
    vi.mocked(uploadFileGetJson).mockResolvedValueOnce(report);
    const { container } = render(<FormCreatorUI />);
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf] } });
    fireEvent.click(screen.getByRole("button", { name: "Detect fields" }));
    await waitFor(() => expect(uploadFileGetJson).toHaveBeenCalledTimes(1));
    return container;
}

/** The form_fields the page sent to /form-creator. */
async function created(): Promise<Record<string, unknown>[]> {
    fireEvent.click(screen.getByRole("button", { name: /Generate fillable PDF/ }));
    await waitFor(() => expect(processAndDownload).toHaveBeenCalledTimes(1));
    const [endpoint, file, , params] = vi.mocked(processAndDownload).mock.calls[0];
    expect(endpoint).toBe("/form-creator");
    expect(file).toBe(pdf);
    return JSON.parse(String((params as Record<string, string>).form_fields));
}

const regions = () => within(screen.getByRole("list", { name: "Page regions" })).getAllByRole("button");
const proposed = () => regions().filter(button => button.dataset.kind === "proposed");
const placed = () => regions().filter(button => button.dataset.kind === "placed");

describe("Form Creator: detect, review, create", () => {
    it("sends the PDF to the detect route only when asked, and shows proposals apart from placed fields", async () => {
        const { container } = render(<FormCreatorUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf] } });
        expect(uploadFileGetJson).not.toHaveBeenCalled();
        vi.mocked(uploadFileGetJson).mockResolvedValueOnce(REPORT);
        fireEvent.click(screen.getByRole("button", { name: "Detect fields" }));
        expect(uploadFileGetJson).toHaveBeenCalledWith("/form-creator/detect", pdf);
        expect(await screen.findByText(/Found 4 possible fields on 1 page/)).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Proposed fields (4)" })).toBeInTheDocument();
        // Drawn on the page as proposals, beside the one placed field the editor starts with.
        expect(proposed().map(b => b.textContent)).toEqual([
            "Proposed text field full_name", "Proposed date field date_of_birth",
            "Proposed checkbox field smoker_yes", "Proposed signature field signature",
        ]);
        expect(placed().map(b => b.textContent)).toEqual(["field_1"]);
        // Each proposal says how clearly the page draws it, and where it was found.
        expect(screen.getAllByText("Likely")).toHaveLength(3);
        expect(screen.getAllByText("Possible")).toHaveLength(1);
        expect(screen.getByText("Possible").closest("p")).toHaveTextContent("Possible checkbox field · page 1 · from “Yes”");
        expect(screen.getByText(/4 proposed fields are still to review/)).toBeInTheDocument();
    });

    it("accepts all: every proposal becomes a field, the untouched starter field goes, and a date is a text field", async () => {
        await detect();
        fireEvent.click(screen.getByRole("button", { name: /Accept all/ }));
        expect(proposed()).toEqual([]);
        expect(placed().map(b => b.textContent)).toEqual(["full_name", "date_of_birth", "smoker_yes", "signature"]);
        expect(screen.getByText(/You reviewed all 4 proposed fields: 4 accepted/)).toBeInTheDocument();
        const fields = await created();
        expect(fields.map(f => [f.name, f.type])).toEqual([
            ["full_name", "text"], ["date_of_birth", "text"], ["smoker_yes", "checkbox"], ["signature", "signature"],
        ]);
        expect(fields[0]).toMatchObject({ page: 1, x: 120, y: 100, width: 300, height: 17 });
    });

    it("accepts one, rejects one, edits one first, and creates only what was accepted", async () => {
        await detect();
        fireEvent.click(screen.getByRole("button", { name: "Accept full_name" }));
        fireEvent.click(screen.getByRole("button", { name: "Reject smoker_yes" }));
        // Edit before accepting: a better name, and a signature made a text field.
        fireEvent.change(screen.getByLabelText("Name of proposed field 2"), { target: { value: "signed_by" } });
        fireEvent.change(screen.getByLabelText("Type of proposed field 2"), { target: { value: "text" } });
        fireEvent.click(screen.getByRole("button", { name: "Accept signed_by" }));
        // One is still waiting, and is not sent.
        expect(screen.getByRole("heading", { name: "Proposed fields (1)" })).toBeInTheDocument();
        expect(screen.getByText(/1 proposed field is still to review/)).toBeInTheDocument();
        const fields = await created();
        expect(fields.map(f => [f.name, f.type])).toEqual([["full_name", "text"], ["signed_by", "text"]]);
    });

    it("lets an accepted field be edited like any other before the form is made", async () => {
        await detect();
        fireEvent.click(screen.getByRole("button", { name: "Accept full_name" }));
        const name = screen.getAllByLabelText("Field name").find(input => (input as HTMLInputElement).value === "full_name")!;
        fireEvent.change(name, { target: { value: "applicant_name" } });
        fireEvent.click(screen.getByRole("checkbox", { name: /REQUIRED/ }) as HTMLElement);
        const fields = await created();
        expect(fields).toEqual([expect.objectContaining({ name: "applicant_name", type: "text", required: true })]);
    });

    it("keeps a field the visitor placed, and never proposes the same blank twice", async () => {
        await detect();
        fireEvent.click(screen.getByRole("button", { name: "Accept full_name" }));
        vi.mocked(uploadFileGetJson).mockResolvedValueOnce(REPORT);
        fireEvent.click(screen.getByRole("button", { name: "Detect again" }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "Proposed fields (3)" })).toBeInTheDocument());
        expect(proposed().map(b => b.textContent)).not.toContain("Proposed text field full_name");
        // A name already in use gets a number when its proposal is accepted.
        fireEvent.change(screen.getByLabelText("Name of proposed field 1"), { target: { value: "full_name" } });
        fireEvent.click(screen.getByRole("button", { name: "Accept full_name" }));
        expect(placed().map(b => b.textContent)).toEqual(["full_name", "full_name_2"]);
    });

    it("keeps focus in the review when a proposal's row goes, and says what was done", async () => {
        await detect();
        // As a browser does, the pressed button has focus when its row goes.
        const press = (name: string | RegExp) => { const b = screen.getByRole("button", { name }); b.focus(); fireEvent.click(b); };
        const said = (text: string) => expect(screen.getByText(text)).toHaveAttribute("role", "status");
        press("Accept full_name");
        expect(document.activeElement).toBe(screen.getByLabelText("Name of proposed field 1"));
        expect(document.activeElement).toHaveValue("date_of_birth");
        said("Accepted full_name. 3 proposed fields left to review.");
        press("Reject signature");
        expect(document.activeElement).toHaveValue("smoker_yes");
        said("Rejected signature. 2 proposed fields left to review.");
        press(/Accept all/);
        expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Find fields automatically" }));
        // The summary says it now, once: the line for each action is empty.
        expect(screen.getByText(/You reviewed all 4 proposed fields: 3 accepted/)).toBeInTheDocument();
        expect(screen.queryByText(/left to review/)).toBeNull();
    });

    it("brings focus back to the review when detection answers", async () => {
        const run = async (report: DetectReport) => {
            vi.mocked(uploadFileGetJson).mockResolvedValueOnce(report);
            const { container } = render(<FormCreatorUI />);
            fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf] } });
            // The button is disabled while detection works, so a browser has
            // dropped its focus by the time the answer comes: none is held here.
            fireEvent.click(screen.getByRole("button", { name: "Detect fields" }));
            await waitFor(() => expect(uploadFileGetJson).toHaveBeenCalled());
        };
        await run(REPORT);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Proposed fields (4)" })));
        cleanup();
        vi.mocked(uploadFileGetJson).mockReset();
        await run({ ...REPORT, candidates: [] });
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Find fields automatically" })));
    });

    it("leaves focus where the visitor moved it while detection worked", async () => {
        let answer: (report: DetectReport) => void = () => undefined;
        vi.mocked(uploadFileGetJson).mockReturnValueOnce(new Promise<DetectReport>(resolve => { answer = resolve; }));
        const { container } = render(<FormCreatorUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf] } });
        fireEvent.click(screen.getByRole("button", { name: "Detect fields" }));
        const name = container.querySelector<HTMLInputElement>(".fc-controls input")!;
        name.focus();
        answer(REPORT);
        await screen.findByRole("heading", { name: "Proposed fields (4)" });
        expect(document.activeElement).toBe(name);
    });

    it("leaves focus where the visitor moved it while a row went", async () => {
        await detect();
        const accept = screen.getByRole("button", { name: "Accept full_name" });
        accept.focus();
        // The visitor's focus is already in the next field when the row goes.
        const typeBox = screen.getByLabelText("Type of proposed field 2");
        accept.addEventListener("click", () => typeBox.focus());
        fireEvent.click(accept);
        expect(document.activeElement).toBe(typeBox);
    });

    it("selects a proposal from the page", async () => {
        await detect();
        fireEvent.click(proposed()[2]);
        expect(screen.getByLabelText("Name of proposed field 3").closest("li")).toHaveAttribute("data-selected", "true");
    });

    it("says when nothing was found, and how to place fields by hand", async () => {
        await detect({ ...REPORT, candidates: [] });
        expect(await screen.findByText(/No likely fields were found/)).toHaveTextContent("choose Draw a field");
        expect(screen.queryByRole("heading", { name: /Proposed fields/ })).toBeNull();
    });

    it("names pages that are pictures, too crowded or unreadable, and fields the PDF already has", async () => {
        await detect({ ...REPORT, pages: 5, scanPages: [1], complexPages: [3, 4], pagesNotChecked: [5], existingFields: 2 });
        expect(await screen.findByText(/Page 1 is a picture, as scanned pages are/)).toBeInTheDocument();
        expect(screen.getByText(/Pages 3 and 4 draw too much/)).toBeInTheDocument();
        expect(screen.getByText(/Page 5 could not be read/)).toBeInTheDocument();
        expect(screen.getByText(/already has 2 fillable fields/)).toHaveTextContent("use Fill Form");
        expect(screen.getByRole("link", { name: "Fill Form" })).toHaveAttribute("href", "/tool/fill-form");
    });

    it("shows a refusal in the server's own words, and proposes nothing", async () => {
        const refusal = Object.assign(new Error("This PDF's pages are pictures, as a scan's are."), {
            __status: 422, __detail: "This PDF's pages are pictures, as a scan's are. Place the fields by hand.",
        });
        vi.mocked(uploadFileGetJson).mockRejectedValueOnce(refusal);
        const { container } = render(<FormCreatorUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [pdf] } });
        fireEvent.click(screen.getByRole("button", { name: "Detect fields" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("This PDF's pages are pictures, as a scan's are. Place the fields by hand.");
        expect(proposed()).toEqual([]);
        // The manual editor is still there.
        expect(placed().map(b => b.textContent)).toEqual(["field_1"]);
    });

    it("drops the proposals of a file that was replaced", async () => {
        const container = await detect();
        expect(proposed()).toHaveLength(4);
        fireEvent.click(screen.getByRole("button", { name: "Remove membership.pdf" }));
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File(["%PDF-1.7"], "other.pdf", { type: "application/pdf" })] } });
        expect(proposed()).toEqual([]);
        expect(screen.getByRole("button", { name: "Detect fields" })).toBeInTheDocument();
    });
});
