import { fireEvent, render, screen, within } from "@testing-library/react";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alphaFor } from "@/lib/gemini-watermark/alpha";
import { sparklePlacements, type Family } from "@/lib/gemini-watermark/geometry";
import { MASK_SOURCES } from "@/lib/gemini-watermark/masks";
import { decodePng } from "@/lib/gemini-watermark/png";
import { applySparkle, background, jpegLike, pictureToPng, solid } from "@/test/gemini-fixtures";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), downloadBlob: mocks.download }));
import { GeminiWatermarkUI } from "./GeminiWatermarkUI";
import { placeLabel } from "@/lib/gemini-watermark/labels";

const RUN_EVENT = "privatools:tool-run";

function watermarked(width: number, height: number, family: Family, name: string) {
    const original = background("gradient", width, height, width);
    const p = sparklePlacements(width, height).find(placement => placement.family === family)!;
    const size = Math.round(MASK_SOURCES[p.mask].size * p.scaleX);
    const image = applySparkle(original, alphaFor(p.mask, size), p.left, p.top, p.gain);
    return { original, file: new File([pictureToPng(image)], name, { type: "image/png" }) };
}

const png = (name: string, width = 640, height = 480) => new File([pictureToPng(background("noise", width, height, 2))], name, { type: "image/png" });

let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
    mocks.download.mockReset();
    // Nothing may leave the tab: any request fails the test.
    network = vi.fn(() => { throw new Error("network request made"); });
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("XMLHttpRequest", network);
});
afterEach(() => vi.unstubAllGlobals());

function choose(container: HTMLElement, files: File[]) {
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: "Remove sparkle" }));
}

describe("Gemini Watermark Remover page", () => {
    it("says what it removes, what it keeps and how not to use it", () => {
        render(<GeminiWatermarkUI />);
        expect(screen.getByText(/SynthID, Google’s invisible watermark, stays in the image/)).toBeInTheDocument();
        expect(screen.getByText(/pass an AI picture off as a real photo/)).toBeInTheDocument();
        expect(screen.getByText(/JPEG and lossy WebP are saved again at quality 95/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /mask credits/i })).toHaveAttribute("href", "/third-party/gemini-watermark-masks.txt");
    });

    it("describes where the logo was by size and distance, not by version", () => {
        expect(placeLabel({ size: 48, marginRight: 96, marginBottom: 96 })).toBe("48 px logo, 96 px from the corner");
        expect(placeLabel({ size: 36, marginRight: 71, marginBottom: 72 })).toBe("36 px logo, 71 px from the right and 72 px from the bottom");
    });

    it("cleans two watermarked images, leaves a clean one unchanged and downloads only the cleaned pair", async () => {
        const runs: unknown[] = [];
        const listener = (event: Event) => runs.push((event as CustomEvent).detail);
        window.addEventListener(RUN_EVENT, listener);
        const first = watermarked(1024, 1024, "corner-32", "castle.png");
        const second = watermarked(1376, 768, "inset-96", "harbour.png");
        const clean = new File([pictureToPng(background("photo", 800, 600, 9))], "meadow.png", { type: "image/png" });

        const { container } = render(<GeminiWatermarkUI />);
        choose(container, [first.file, second.file, clean]);

        await screen.findByRole("heading", { name: "2 images cleaned." }, { timeout: 30_000 });
        const shelf = screen.getByLabelText("Your images");
        expect(within(shelf).getByText("Sparkle removed · 48 px logo, 32 px from the corner")).toBeInTheDocument();
        expect(within(shelf).getByText("Sparkle removed · 48 px logo, 96 px from the corner")).toBeInTheDocument();
        expect(within(shelf).getByText("No Gemini sparkle found · left unchanged")).toBeInTheDocument();
        expect(screen.getByText("2 cleaned · 1 with no sparkle found, left unchanged")).toBeInTheDocument();
        // The result is announced and takes the focus the Run button had.
        expect(screen.getByRole("status")).toHaveTextContent("Sparkle removed.");
        expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sparkle removed." }));

        fireEvent.click(screen.getByRole("button", { name: "Download 2 images as ZIP" }));
        await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
        const [zip, zipName] = mocks.download.mock.calls[0] as [Blob, string];
        expect(zipName).toBe("gemini-sparkle-removed.zip");
        const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
        expect(Object.keys(entries).sort()).toEqual(["castle_no-sparkle.png", "harbour_no-sparkle.png"]);
        for (const [name, source] of [["castle_no-sparkle.png", first.original], ["harbour_no-sparkle.png", second.original]] as const) {
            const out = decodePng(entries[name]).rgba;
            let worst = 0;
            for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - source.data[i]));
            expect(worst, name).toBeLessThanOrEqual(3);
        }

        expect(network).not.toHaveBeenCalled();
        // The image left unchanged is a miss in the usage signal, though the page shows it as handled.
        expect(runs).toEqual([{ mode: "single", outcome: "partial", files: 3, errorKind: "bad_input" }]);
        window.removeEventListener(RUN_EVENT, listener);
    }, 60_000);

    it("says nothing was found, and shows the corner where Gemini puts the sparkle", async () => {
        const { container } = render(<GeminiWatermarkUI />);
        choose(container, [png("grain.png")]);
        await screen.findByRole("heading", { name: "No sparkle found." }, { timeout: 30_000 });
        expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
        expect(screen.getByText("No Gemini sparkle found at the sizes and places this tool checks. Nothing was changed.")).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "The corner, enlarged" })).toBeInTheDocument();
        expect(screen.getByText(/If you can see it here, the tool did not find it/)).toBeInTheDocument();
    }, 30_000);

    it("reports a file it cannot read without claiming a result", async () => {
        const { container } = render(<GeminiWatermarkUI />);
        choose(container, [new File(["not an image"], "notes.png", { type: "image/png" })]);
        await screen.findByRole("heading", { name: "Let’s try that again." }, { timeout: 30_000 });
        expect(screen.getByRole("alert")).toHaveTextContent(/not a PNG, JPEG or WebP/);
        expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    }, 30_000);

    it("calls a damaged PNG a damaged image, not a damaged PDF", async () => {
        const bytes = pictureToPng(background("gradient", 64, 64));
        const { container } = render(<GeminiWatermarkUI />);
        choose(container, [new File([bytes.slice(0, bytes.length - 40)], "cut.png", { type: "image/png" })]);
        await screen.findByRole("heading", { name: "Let’s try that again." }, { timeout: 30_000 });
        expect(screen.getByRole("alert")).toHaveTextContent("This PNG file is damaged or incomplete.");
        expect(screen.getByRole("alert")).not.toHaveTextContent(/PDF/);
    }, 30_000);

    it("leaves a re-compressed copy unchanged rather than claim a removal that would leave a trace", async () => {
        const runs: unknown[] = [];
        const listener = (event: Event) => runs.push((event as CustomEvent).detail);
        window.addEventListener(RUN_EVENT, listener);
        // The fainter 48 px logo 96 px in, on flat colour, then saved again as JPEG at quality 75 by some app.
        const image = jpegLike(applySparkle(solid(480, 480, [186, 220, 74]), alphaFor("v1-48", 48), 336, 336, 0.6), 75);
        const { container } = render(<GeminiWatermarkUI />);
        choose(container, [new File([pictureToPng(image)], "resaved.png", { type: "image/png" })]);
        await screen.findByRole("heading", { name: "Not removed cleanly." }, { timeout: 30_000 });
        expect(screen.getByRole("heading", { name: "Nothing was changed." })).toBeInTheDocument();
        expect(within(screen.getByLabelText("Your images")).getByText("Sparkle found, but not removed cleanly · left unchanged")).toBeInTheDocument();
        // It names where the layout puts the logo, not the smaller fit the search settled on.
        expect(screen.getByText(/A Gemini sparkle was found \(48 px logo, 96 px from the corner\), but removing it would leave a trace that would stand out/)).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "The corner, enlarged" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
        expect(runs).toEqual([{ mode: "single", outcome: "error", files: 1, errorKind: "browser" }]);
        window.removeEventListener(RUN_EVENT, listener);
    }, 30_000);
});
