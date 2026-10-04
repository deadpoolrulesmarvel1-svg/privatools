/**
 * Translate PDF on this device: a page is sent to OPUS-MT in pieces counted in
 * the model's own tokens. 900 characters of Chinese were one piece, more than
 * the 512 tokens the model reads, and it dropped the rest without an error.
 * The model and its tokenizer run in a worker (lib/translate/opusMt.ts),
 * stood in for here: the page shows the download, the model loading and
 * each piece, and Cancel ends the worker.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAGE = "北角的灯塔建于一八七四年，在一九二一年的大风暴之后重建。守塔人把每一次天气变化都写在日记里，博物馆至今仍保存着这本日记。".repeat(16);

vi.mock("pdfjs-dist", () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: PAGE }] }) }) }),
    }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "worker.js" }));

const mocks = vi.hoisted(() => ({ load: vi.fn(), stop: vi.fn(), toolRun: vi.fn(), sent: [] as string[] }));
vi.mock("@/lib/translate/opusMt", async original => ({ ...(await original<object>()), loadDeviceTranslator: mocks.load, stopDeviceTranslator: mocks.stop }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));

import { chunkByTokens, tokenRuns } from "@/lib/translate/chunk";
import { MAX_INPUT_TOKENS, type DeviceTranslator, type ModelStage } from "@/lib/translate/opusMt";
import { TranslatePdfUI } from "./TranslatePdfUI";

/** A token a character, near enough for Chinese: the worker's tokenizer, stood in for. */
const count = (text: string) => Array.from(text).length + 1;
const translator = (modelId: string, translate: (text: string) => Promise<string> = async text => { mocks.sent.push(text); return `[${Array.from(text).length}]`; }): DeviceTranslator => ({
    modelId,
    chunk: async (texts, maxTokens) => texts.map(text => chunkByTokens(text, count, maxTokens)),
    runs: async (texts, maxTokens) => tokenRuns(texts, count, maxTokens),
    translate,
});

beforeEach(() => {
    for (const mock of [mocks.load, mocks.stop, mocks.toolRun]) mock.mockReset();
    mocks.sent.length = 0;
    mocks.load.mockImplementation(async (modelId: string, progress: (percent: number) => void) => { progress(100); return translator(modelId); });
});
afterEach(() => { cleanup(); });

function choosePdf() {
    const view = render(<TranslatePdfUI />);
    const file = new File(["%PDF-1.4"], "notice.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [file] } });
    fireEvent.change(view.container.querySelector("#tr-source")!, { target: { value: "zh" } });
    return view;
}

describe("Translate PDF on this device", () => {
    it("sends a long Chinese page in pieces the model reads whole, and drops none of it", async () => {
        choosePdf();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        await screen.findByRole("button", { name: /Download text/ });
        expect(mocks.sent.length).toBeGreaterThan(5);
        for (const piece of mocks.sent) expect(Array.from(piece).length + 1).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
        expect(mocks.sent.join("")).toBe(PAGE);
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "success", files: 1 });
    });

    it("shows the model's download with its percent, then the model loading, then each piece", async () => {
        let release!: () => void;
        const first = new Promise<void>(resolve => { release = resolve; });
        let hear!: { progress: (percent: number) => void; stage: (stage: ModelStage) => void; ready: () => void };
        mocks.load.mockImplementation((modelId: string, progress: (percent: number) => void, stage: (stage: ModelStage) => void) => new Promise(resolve => {
            hear = {
                progress, stage, ready: () => {
                    progress(100);
                    // The first piece waits, so the count shows before it is done.
                    let pieces = 0;
                    resolve(translator(modelId, async text => { if (pieces++ === 0) await first; return text; }));
                },
            };
        }));
        const { container } = choosePdf();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        // Before the worker says it is downloading there is no percent to show, and none while the model is built.
        expect(await screen.findByText("Loading model")).toBeInTheDocument();
        expect(container.querySelector(".progress-indeterminate")).not.toBeNull();
        act(() => { hear.stage("download"); hear.progress(40); });
        expect(screen.getByText("Downloading model — 40%")).toBeInTheDocument();
        expect(container.querySelector(".progress-indeterminate")).toBeNull();
        act(() => { hear.progress(99); hear.stage("prepare"); });
        expect(screen.getByText("Loading model")).toBeInTheDocument();
        expect(container.querySelector(".progress-indeterminate")).not.toBeNull();
        await act(async () => { hear.ready(); });
        expect(await screen.findByText(/^Translating 0 of \d+$/)).toBeInTheDocument();
        await act(async () => { release(); });
        await screen.findByRole("button", { name: /Download text/ });
    });

    it("cancels at once by ending the model's worker, counts no failure, and starts the next run cleanly", async () => {
        // A load that never finishes, as while the model builds.
        mocks.load.mockImplementationOnce(() => new Promise(() => {}));
        choosePdf();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Translate" })).toBeEnabled();
        expect(screen.queryByText("Loading model")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        await screen.findByRole("button", { name: /Download text/ });
        expect(mocks.sent.join("")).toBe(PAGE);
        expect(mocks.toolRun).toHaveBeenCalledTimes(1);
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "success", files: 1 });
    });

    it("ignores what a cancelled run's worker answers late", async () => {
        let finish!: () => void;
        mocks.load.mockImplementationOnce((modelId: string) => new Promise(resolve => { finish = () => resolve(translator(modelId)); }));
        choosePdf();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        await act(async () => { finish(); });
        expect(mocks.sent).toEqual([]);
        expect(screen.queryByRole("button", { name: /Download text/ })).toBeNull();
        expect(mocks.toolRun).not.toHaveBeenCalled();
    });

    it("ends the worker after a model failure, and reports it as the browser's", async () => {
        mocks.load.mockImplementationOnce(async (modelId: string) => translator(modelId, async () => { throw new Error("Aborted(). Build with -sASSERTIONS for more info."); }));
        choosePdf();
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1 }, expect.objectContaining({ message: "Aborted(). Build with -sASSERTIONS for more info." }));
        expect(screen.getByRole("button", { name: "Translate" })).toBeEnabled();
    });

    it("ends the worker when the page closes", () => {
        const { unmount } = render(<TranslatePdfUI />);
        unmount();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });
});
