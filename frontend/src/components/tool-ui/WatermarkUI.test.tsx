import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatermarkUI } from "./WatermarkUI";
import { downloadBlob, postFormData } from "@/lib/api";

vi.mock("./pdf/PdfWatermarkPreview", () => ({ PdfWatermarkPreview: () => null }));
// The saved-image picker lists stored assets asynchronously; under a loaded
// suite that list could settle after this file's environment is torn down.
// This test picks its image through the upload input instead.
vi.mock("@/components/AssetPicker", () => ({ AssetPicker: () => null }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), postFormData: vi.fn(), downloadBlob: vi.fn() }));

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    vi.mocked(postFormData).mockImplementation(async () => new Response(new Blob(["%PDF-1.7 watermarked"], { type: "application/pdf" })));
});
afterEach(cleanup);

describe("image watermark request", () => {
    it("sends the PDF once, as `file`, beside the watermark image", async () => {
        const { container } = render(<WatermarkUI />);
        const pdf = new File(["%PDF-1.7 synthetic"], "report.pdf", { type: "application/pdf" });
        const logo = new File(["synthetic png"], "logo.png", { type: "image/png" });
        fireEvent.change(container.querySelector('input[type="file"][accept=".pdf"]')!, { target: { files: [pdf] } });
        fireEvent.click(screen.getByRole("button", { name: "Image" }));
        fireEvent.change(container.querySelector('input[type="file"][accept=".png,.jpg,.jpeg,.webp"]')!, { target: { files: [logo] } });
        fireEvent.click(screen.getByRole("button", { name: "Watermark PDF" }));
        await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());

        expect(postFormData).toHaveBeenCalledOnce();
        const [endpoint, build] = vi.mocked(postFormData).mock.calls[0];
        expect(endpoint).toBe("/watermark");
        const body = typeof build === "function" ? build() : build;
        const uploads = [...body.entries()].filter(([, value]) => value instanceof File);
        expect(uploads).toEqual([["file", pdf], ["watermark_image", logo]]);
    });
});
