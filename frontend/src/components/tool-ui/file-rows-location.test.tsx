/**
 * Edit PDF, Extract Pages and Delete Pages draw their own chosen-file rows.
 * On a tool page those rows say where the file goes, as FileUploadZone's do
 * (1b4839c): the intake that said it is gone once a file is chosen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolLocationProvider, toolLocation } from "@/skins/experience/tool-location";
import { PdfPageSelectionUI } from "./pdf/PdfPageSelectionUI";
import { EditPdfUI } from "./EditPdfUI";

vi.mock("./pdf/PdfPageStage", () => ({ PdfPageStage: () => <div data-testid="stage" /> }));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoffs: vi.fn(async () => []) }));
afterEach(cleanup);

const pdf = new File(["%PDF-1.7"], "contract.pdf", { type: "application/pdf" });
const onPage = (ui: JSX.Element) => <ToolLocationProvider value={toolLocation({ slug: "delete-pages" })}>{ui}</ToolLocationProvider>;

describe("chosen-file rows on a tool page", () => {
    it.each(["delete", "extract"] as const)("%s pages: the row says where the file goes", operation => {
        const { container } = render(onPage(<PdfPageSelectionUI operation={operation} />));
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pdf] } });
        const row = container.querySelector(".ts-file")!;
        expect(row).toHaveTextContent("contract.pdf");
        expect(row).toHaveTextContent("Temporary server processing");
        expect(row).not.toHaveTextContent("Ready on this device");
    });

    it("Edit PDF: the editor's header says where the file goes beside its name", () => {
        const { container } = render(onPage(<EditPdfUI />));
        // The editor opens as soon as a file is chosen; the page itself renders later (pdf.js).
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pdf] } });
        expect(screen.getByText("contract.pdf")).toBeInTheDocument();
        expect(container.querySelector(".pdf-editor-where")).toHaveTextContent("Temporary server processing");
    });
});
