/**
 * Transcribe Audio on this device: the spoken language reaches Whisper, and
 * Cancel or closing the page stops Whisper rather than leaving it to finish
 * a recording nobody waits for. Decoding and Whisper are stubbed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), load: vi.fn(), stop: vi.fn(), toolRun: vi.fn() }));
vi.mock("@/lib/whisper", async original => ({ ...(await original<object>()), decodeToMono: mocks.decode, loadWhisper: mocks.load, stopWhisper: mocks.stop }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoff: vi.fn(async () => null), consumeFileHandoffs: vi.fn(async () => []) }));

import { TranscribeAudioUI } from "./TranscribeAudioUI";

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.decode.mockResolvedValue(new Float32Array(16000));
});

function start() {
    const view = render(<MemoryRouter><TranscribeAudioUI /></MemoryRouter>);
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["x"], "memo.mp3", { type: "audio/mpeg" })] } });
    return view;
}

describe("Transcribe Audio on this device", () => {
    it("tells Whisper the language spoken, English unless another is chosen", async () => {
        const asr = vi.fn(async () => ({ text: "Hallo zusammen.", chunks: [{ timestamp: [0, 1] as [number, number], text: "Hallo zusammen." }] }));
        mocks.load.mockResolvedValue(asr);
        start();
        const language = screen.getByLabelText("Language spoken") as HTMLSelectElement;
        expect(language.value).toBe("en");
        expect(language.options.length).toBe(99);
        fireEvent.change(language, { target: { value: "de" } });
        fireEvent.click(screen.getByRole("button", { name: /Transcribe$/ }));
        await screen.findByText("Hallo zusammen.");
        expect(asr).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ language: "de", task: "transcribe", return_timestamps: true }));
    });

    it("stops Whisper on Cancel, so the recording is not transcribed on behind the page", async () => {
        mocks.load.mockResolvedValue(() => new Promise(() => {}));
        start();
        fireEvent.click(screen.getByRole("button", { name: /Transcribe$/ }));
        await screen.findByText(/Listening/);
        fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByRole("button", { name: /Transcribe$/ })).toBeEnabled());
    });

    it("stops Whisper when the page closes, and after a run that fails", async () => {
        mocks.load.mockResolvedValue(async () => { throw new Error("session run failed"); });
        const view = start();
        fireEvent.click(screen.getByRole("button", { name: /Transcribe$/ }));
        await waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1));
        view.unmount();
        expect(mocks.stop).toHaveBeenCalledTimes(2);
    });
});
