import { fireEvent, render, screen, within } from "@testing-library/react";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alphaFor } from "@/lib/gemini-watermark/alpha";
import { sparkleCandidates } from "@/lib/gemini-watermark/geometry";
import { decodePng } from "@/lib/gemini-watermark/png";
import { applySparkle, background, pictureToPng } from "@/test/gemini-fixtures";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), downloadBlob: mocks.download }));
import { GeminiWatermarkUI } from "./GeminiWatermarkUI";

const RUN_EVENT = "privatools:tool-run";

function watermarked(width: number, height: number, layout: "legacy" | "current", name: string) {
    const original = background("gradient", width, height, width);
    const target = sparkleCandidates(width, height).find(candidate => candidate.layout === layout)!;
    const image = applySparkle(original, alphaFor(target.mask, target.size), target.x, target.y);
    return { original, file: new File([pictureToPng(image)], name, { type: "image/png" }) };
}

let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
    mocks.download.mockReset();
    // Nothing may leave the tab: any request fails the test.
    network = vi.fn(() => { throw new Error("network request made"); });
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("XMLHttpRequest", network);
});
afterEach(() => vi.unstubAllGlobals());

describe("Gemini Watermark Remover page", () => {
    it("says what it removes, what it keeps and how not to use it", () => {
        render(<GeminiWatermarkUI />);
        expect(screen.getByText(/SynthID, Google’s invisible watermark, stays in the image/)).toBeInTheDocument();
        expect(screen.getByText(/pass an AI picture off as a real photo/)).toBeInTheDocument();
        expect(screen.getByText(/JPEG and lossy WebP are saved again at quality 95/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /mask credits/i })).toHaveAttribute("href", "/third-party/gemini-watermark-masks.txt");
    });

    it("cleans two watermarked images, leaves a clean one unchanged and downloads only the cleaned pair", async () => {
        const runs: unknown[] = [];
        const listener = (event: Event) => runs.push((event as CustomEvent).detail);
        window.addEventListener(RUN_EVENT, listener);
        const first = watermarked(1024, 1024, "legacy", "castle.png");
        const second = watermarked(1376, 768, "current", "harbour.png");
        const clean = new File([pictureToPng(background("photo", 800, 600, 9))], "meadow.png", { type: "image/png" });

        const { container } = render(<GeminiWatermarkUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [first.file, second.file, clean] } });
        fireEvent.click(screen.getByRole("button", { name: "Remove sparkle" }));

        await screen.findByRole("heading", { name: "2 images cleaned." }, { timeout: 20_000 });
        const shelf = screen.getByLabelText("Your images");
        expect(within(shelf).getByText("Sparkle removed · 48 px logo, layout before Gemini 3.5")).toBeInTheDocument();
        expect(within(shelf).getByText("Sparkle removed · 48 px logo, current layout")).toBeInTheDocument();
        expect(within(shelf).getByText("No Gemini sparkle found · left unchanged")).toBeInTheDocument();
        expect(screen.getByText("2 cleaned · 1 with no sparkle, left unchanged")).toBeInTheDocument();

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
            expect(worst, name).toBeLessThanOrEqual(1);
        }

        expect(network).not.toHaveBeenCalled();
        expect(runs).toEqual([{ mode: "single", outcome: "success", files: 3 }]);
        window.removeEventListener(RUN_EVENT, listener);
    }, 60_000);

    it("says nothing was changed when no image carries the sparkle", async () => {
        const { container } = render(<GeminiWatermarkUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File([pictureToPng(background("noise", 640, 480, 2))], "grain.png", { type: "image/png" })] } });
        fireEvent.click(screen.getByRole("button", { name: "Remove sparkle" }));
        await screen.findByRole("heading", { name: "No sparkle to remove." }, { timeout: 20_000 });
        expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
        expect(screen.getByText("No Gemini sparkle found. Nothing was changed.")).toBeInTheDocument();
    }, 30_000);

    it("reports a file it cannot read without claiming a result", async () => {
        const { container } = render(<GeminiWatermarkUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File(["not an image"], "notes.png", { type: "image/png" })] } });
        fireEvent.click(screen.getByRole("button", { name: "Remove sparkle" }));
        await screen.findByRole("heading", { name: "Let’s try that again." }, { timeout: 20_000 });
        expect(screen.getByRole("alert")).toHaveTextContent(/not a PNG, JPEG or WebP/);
        expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    }, 30_000);
});
