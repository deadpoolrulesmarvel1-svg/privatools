import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FileUploadZone } from "./FileUploadZone";
import { ToolLocationProvider, toolLocation } from "@/skins/experience/tool-location";

afterEach(cleanup);

const pdf = new File(["%PDF-1.7"], "contract.pdf", { type: "application/pdf" });

describe("FileUploadZone's chosen-file row", () => {
    it("keeps saying where the file goes on a tool page once a file is chosen", () => {
        // Sign, Redact, Fill Form and the other editors hide the page's location
        // line after a choice; this row is then the only place that says it.
        render(<ToolLocationProvider value={toolLocation({ slug: "sign-pdf" })}>
            <FileUploadZone file={pdf} onFileSelect={vi.fn()} onClear={vi.fn()} accept=".pdf" />
        </ToolLocationProvider>);
        expect(screen.getByText(/Temporary server processing/)).toBeInTheDocument();
        expect(screen.queryByText(/Ready on this device/)).toBeNull();
    });

    it("says the file is ready on this device where no tool page says otherwise", () => {
        render(<FileUploadZone file={pdf} onFileSelect={vi.fn()} onClear={vi.fn()} accept=".pdf" />);
        expect(screen.getByText(/Ready on this device/)).toBeInTheDocument();
    });
});
