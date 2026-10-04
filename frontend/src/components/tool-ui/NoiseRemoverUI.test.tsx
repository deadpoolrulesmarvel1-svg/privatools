/**
 * What the Voice Noise Remover page shows and does: a run from a chosen file
 * to the original and the cleaned sound side by side and a WAV to download,
 * and each way it can end. The engine is stubbed; its own tests are in
 * lib/noise, with the real RNNoise.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoiseResult, NoiseRunOptions } from "@/lib/noise/engine";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), download: vi.fn(), toolRun: vi.fn() }));
vi.mock("@/lib/noise/engine", () => ({ removeNoise: mocks.remove }));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), downloadBlob: mocks.download }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));

import { NoiseEngineError } from "@/lib/noise/errors";
import { NoiseInputError } from "@/lib/noise/source";
import { NoiseRemoverUI } from "./NoiseRemoverUI";

function result(overrides: Partial<NoiseResult> = {}, stats: Partial<NoiseResult["stats"]> = {}): NoiseResult {
    return {
        wav: new Blob([new Uint8Array(44 + 96000)], { type: "audio/wav" }),
        seconds: 125,
        gaps: [],
        container: "MP3",
        ...overrides,
        stats: {
            frames: 125 * 48000, channels: 1, sourceChannels: 1, inputPeak: 0.6, inputPower: 0.01, outputPower: 0.004,
            heardFrames: 12500, speechFrames: 9000, clipped: 0, rate: 44100,
            stitch: { joins: 2, matched: 2, silent: 0, unmatched: 0, largestOffset: 0 },
            ...stats,
        },
    };
}

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    localStorage.clear();
});

function choose(name = "interview.mp3", type = "audio/mpeg") {
    const view = render(<MemoryRouter><NoiseRemoverUI /></MemoryRouter>);
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["x"], name, { type })] } });
    return view;
}

const run = () => fireEvent.click(screen.getByRole("button", { name: /Remove noise/ }));

describe("the Voice Noise Remover page", () => {
    it("takes audio and video files, and does nothing until asked", () => {
        const view = render(<MemoryRouter><NoiseRemoverUI /></MemoryRouter>);
        const input = view.container.querySelector<HTMLInputElement>("input[type=file]")!;
        expect(input.accept.split(",")).toEqual(expect.arrayContaining([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4", ".mov", ".mkv"]));
        expect(screen.getByRole("button", { name: /Remove noise/ })).toBeDisabled();
        expect(screen.getByText(/up to 60 minutes of mono or 30 of stereo, 15 for OGG and FLAC/)).toBeInTheDocument();
        fireEvent.change(input, { target: { files: [new File(["x"], "interview.mp3", { type: "audio/mpeg" })] } });
        expect(within(screen.getByRole("region", { name: "Chosen file" })).getByText("interview.mp3", { selector: ".ts-file-name" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Remove noise/ })).toBeEnabled();
        expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("says what it is for and links the engine's licences", () => {
        render(<MemoryRouter><NoiseRemoverUI /></MemoryRouter>);
        expect(screen.getByText(/isn’t for music, and it doesn’t remove other voices or echo/)).toBeInTheDocument();
        expect(screen.getByText(/rather than recreating the voice/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /RNNoise credits/ })).toHaveAttribute("href", "/third-party/rnnoise.txt");
    });

    it("cleans at full strength unless asked, and passes the strength it's set to", async () => {
        mocks.remove.mockResolvedValue(result());
        choose();
        const strength = screen.getByLabelText(/How much of the cleaned sound/) as HTMLInputElement;
        expect(strength.value).toBe("100");
        expect(strength).toHaveAttribute("aria-valuetext", "100%: only the cleaned sound");
        // Steps of five, so there is a gentler step down from 100% than 90%.
        expect(strength).toHaveAttribute("step", "5");
        fireEvent.change(strength, { target: { value: "95" } });
        expect(strength).toHaveAttribute("aria-valuetext", "95%: 95% cleaned sound, 5% original");
        fireEvent.change(strength, { target: { value: "70" } });
        expect(strength).toHaveAttribute("aria-valuetext", "70%: 70% cleaned sound, 30% original");
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect((mocks.remove.mock.calls[0][1] as NoiseRunOptions).strength).toBeCloseTo(0.7, 9);
    });

    it("shows the original and the cleaned sound, then downloads the WAV only when asked", async () => {
        const cleaned = result();
        mocks.remove.mockResolvedValue(cleaned);
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        const players = screen.getByRole("region", { name: "Compare before and after" });
        expect(within(players).getByLabelText("Original: interview.mp3").getAttribute("src")).toMatch(/^blob:/);
        expect(within(players).getByLabelText("Cleaned sound").getAttribute("src")).toMatch(/^blob:/);
        expect(screen.getByText("2:05")).toBeInTheDocument();
        expect(mocks.download).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: /Download WAV/ }));
        expect(mocks.download).toHaveBeenCalledWith(cleaned.wav, "interview-clean.wav");
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "success", files: 1 });
        expect(screen.getByText(/nothing was uploaded/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Audio Converter" })).toHaveAttribute("href", "/tools/audio-converter");
        expect(screen.getByRole("link", { name: "Transcribe Audio" })).toHaveAttribute("href", "/tools/transcribe-audio");
    });

    it("doesn't send a WAV to a tool that won't take it: Audio Converter takes 200 MB, Transcribe Audio 500 MB", async () => {
        const big = result();
        // 30 minutes of stereo: past Audio Converter's 200 MB, within Transcribe Audio's 500 MB.
        Object.defineProperty(big.wav, "size", { value: 345_600_044 });
        mocks.remove.mockResolvedValue(big);
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect(screen.queryByRole("link", { name: "Audio Converter" })).toBeNull();
        expect(screen.getByText(/larger than the 200 MB that Audio Converter takes, so an audio app on your device can make an MP3 of it/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Transcribe Audio" })).toHaveAttribute("href", "/tools/transcribe-audio");
    });

    it("sends a WAV past 500 MB to neither tool", async () => {
        const huge = result();
        Object.defineProperty(huge.wav, "size", { value: 541_440_044 });
        mocks.remove.mockResolvedValue(huge);
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect(screen.queryByRole("link", { name: "Audio Converter" })).toBeNull();
        expect(screen.queryByRole("link", { name: "Transcribe Audio" })).toBeNull();
        expect(screen.getByText(/also larger than the 500 MB that Transcribe Audio takes/)).toBeInTheDocument();
    });

    it("calls a result shorter than a second what it is, rather than 0:00", async () => {
        mocks.remove.mockResolvedValue(result({ seconds: 0.4 }));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        const stats = document.querySelector(".ts-stats")!;
        expect(within(stats as HTMLElement).getAllByText("under a second").length).toBeGreaterThanOrEqual(1);
        expect(within(stats as HTMLElement).queryByText("0:00")).toBeNull();
    });

    it("pauses one player when the other plays", async () => {
        mocks.remove.mockResolvedValue(result());
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        const before = screen.getByLabelText("Original: interview.mp3") as HTMLAudioElement;
        const after = screen.getByLabelText("Cleaned sound") as HTMLAudioElement;
        const pause = vi.fn();
        Object.defineProperty(before, "paused", { value: false, configurable: true });
        before.pause = pause;
        fireEvent.play(after);
        expect(pause).toHaveBeenCalled();
    });

    it("says from a video only the sound comes back", async () => {
        mocks.remove.mockResolvedValue(result({ container: "MP4" }));
        choose("clip.mp4", "video/mp4");
        expect(screen.getByText(/1 video/)).toBeInTheDocument();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect(screen.getByText(/From a video, only the cleaned sound comes back/)).toBeInTheDocument();
    });

    it("calls a WebM neither a video nor a recording, since it can be either", async () => {
        mocks.remove.mockResolvedValue(result({ container: "Matroska" }));
        choose("call.webm", "video/webm");
        expect(screen.getByText(/1 file/)).toBeInTheDocument();
        expect(screen.getByText(/WebM: its sound is cleaned/)).toBeInTheDocument();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect(screen.getByText("Only the cleaned sound comes back. If the WebM is a video, put the WAV back with the picture in a video editor.")).toBeInTheDocument();
        expect(screen.queryByText(/From a video/)).toBeNull();
    });

    it("warns when RNNoise heard little speech", async () => {
        mocks.remove.mockResolvedValue(result({}, { speechFrames: 100 }));
        choose("song.mp3");
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        expect(screen.getByText(/RNNoise heard little speech in this recording/)).toBeInTheDocument();
    });

    it("says where it couldn't decode the sound, as a partial result", async () => {
        mocks.remove.mockResolvedValue(result({ gaps: [{ start: 60, end: 120 }] }));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Noise reduced, with a gap." });
        expect(screen.getByText(/couldn’t decode 1:00–2:00 of the sound, so that part is silent/)).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "partial", files: 1, errorKind: "browser" });
    });

    it("calls a silent recording what it is, with nothing to download", async () => {
        mocks.remove.mockResolvedValue(result({}, { inputPeak: 0 }));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "This recording is silent." });
        expect(screen.queryByRole("button", { name: /Download WAV/ })).toBeNull();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "bad_input" });
    });

    it.each([
        [new NoiseInputError("empty", "This file is empty, so there is no sound in it."), "This file is empty.", null],
        [new NoiseInputError("no-sound", "This file has no sound track, so there is nothing to clean."), "This file has no sound.", null],
        [new NoiseInputError("too-long", "This file’s sound is 1 h 30 min long. Voice Noise Remover takes up to 60 minutes of mono or 30 of stereo at a time.", 5400), "This recording is too long to clean here.", /parts of up to 60 minutes of mono or 30 of stereo, cut it with Cut \/ Trim Video & Audio/],
        [new NoiseInputError("too-long-stereo", "This file’s sound is stereo and 47 minutes long. Voice Noise Remover takes stereo up to 30 minutes and mono up to 60.", 2820), "This stereo recording is too long to clean here.", /parts of up to 30 minutes.*save it as mono, which works here up to 60 minutes/],
        [new NoiseInputError("unreadable", "This browser can’t decode the sound in this file."), "This browser can’t read the sound in this file.", /Audio Converter/],
    ])("fails clearly, without a retry: %s", async (error, title, help) => {
        mocks.remove.mockRejectedValue(error);
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: title });
        if (help) {
            const note = document.querySelector(".nr-help")!;
            expect(note.textContent).toMatch(help);
            expect(note.textContent).toMatch(/upload/);
        }
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", files: 1 }), error);
    });

    it("says the browser refused WebAssembly when the engine can't start", async () => {
        mocks.remove.mockRejectedValue(new NoiseEngineError("This browser didn’t let the noise remover’s WebAssembly run (CompileError).", "wasm"));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "The noise remover couldn’t start." });
        expect(screen.getByText(/didn’t let it run WebAssembly/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(mocks.toolRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", errorKind: "browser" }), expect.any(NoiseEngineError));
    });

    it("says when the browser ran out of memory", async () => {
        mocks.remove.mockRejectedValue(new RangeError("Array buffer allocation failed"));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "This browser ran out of memory." });
    });

    it("doesn't call every RangeError a lack of memory", async () => {
        mocks.remove.mockRejectedValue(new RangeError("Sample rates must be whole numbers above 0"));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "The noise couldn’t be removed." });
    });

    it("offers another try when the noise remover's download dropped", async () => {
        mocks.remove.mockRejectedValueOnce(Object.assign(new Error("The noise remover couldn’t be downloaded."), { __kind: "network" }));
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "The noise remover couldn’t be downloaded." });
        mocks.remove.mockResolvedValueOnce(result());
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
    });

    it("stops on Cancel, back to the file and its settings, and counts no run", async () => {
        let options: NoiseRunOptions | undefined;
        mocks.remove.mockImplementation((_file: File, given: NoiseRunOptions) => new Promise((_, reject) => {
            options = given;
            given.onStage?.("cleaning");
            given.onProgress?.(30, 120);
            given.signal?.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" })));
        }));
        choose();
        await act(async () => { run(); });
        await screen.findByText("Removing background noise");
        expect(screen.getByText(/0:30 of 2:00/)).toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
        expect(options?.signal?.aborted).toBe(true);
        await waitFor(() => expect(screen.getByRole("button", { name: /Remove noise/ })).toBeEnabled());
        expect(mocks.toolRun).not.toHaveBeenCalled();
    });

    it("keeps focus on a control: Cancel while it works, through every stage, then Remove noise", async () => {
        let options: NoiseRunOptions | undefined;
        mocks.remove.mockImplementation((_file: File, given: NoiseRunOptions) => new Promise((_, reject) => {
            options = given;
            given.signal?.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" })));
        }));
        choose();
        const button = screen.getByRole("button", { name: /Remove noise/ });
        button.focus();
        await act(async () => { fireEvent.click(button); });
        expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
        const cancel = screen.getByRole("button", { name: "Cancel" });
        act(() => { options!.onStage?.("starting"); });
        act(() => { options!.onStage?.("cleaning"); });
        await screen.findByText("Removing background noise");
        expect(screen.getByRole("button", { name: "Cancel" })).toBe(cancel);
        expect(cancel).toHaveFocus();
        await act(async () => { fireEvent.click(cancel); });
        await waitFor(() => expect(screen.getByRole("button", { name: /Remove noise/ })).toHaveFocus());
    });

    it("puts focus on Cancel when Ctrl+Enter starts a run from the strength slider, which the run disables", async () => {
        mocks.remove.mockImplementation(() => new Promise(() => {}));
        choose();
        const strength = screen.getByLabelText(/How much of the cleaned sound/);
        strength.focus();
        await act(async () => { fireEvent.keyDown(window, { key: "Enter", ctrlKey: true }); });
        expect(strength).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("moves the progress about once a second, and keeps the clock out of the announced status", async () => {
        let options: NoiseRunOptions | undefined;
        mocks.remove.mockImplementation((_file: File, given: NoiseRunOptions) => new Promise(() => { options = given; }));
        const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
        try {
            choose();
            await act(async () => { run(); });
            act(() => { options!.onStage?.("cleaning"); options!.onProgress?.(0, 120); });
            act(() => { options!.onProgress?.(5, 120); options!.onProgress?.(10, 120); });
            expect(screen.getByText(/^0:00 of 2:00/)).toBeInTheDocument();
            now.mockReturnValue(11_000);
            act(() => { options!.onProgress?.(15, 120); });
            expect(screen.getByText(/^0:15 of 2:00/)).toBeInTheDocument();
            const status = document.querySelector<HTMLElement>(".ts-progress")!;
            expect(status).toHaveAttribute("aria-live", "polite");
            expect(within(status).queryByText(/of 2:00/)).toBeNull();
            expect(within(status).getByText("13%")).toBeInTheDocument();
        } finally {
            now.mockRestore();
        }
    });

    it("goes back to the settings with the same file to clean at another strength", async () => {
        mocks.remove.mockResolvedValue(result());
        choose();
        await act(async () => { run(); });
        await screen.findByRole("heading", { name: "Background noise reduced." });
        const change = screen.getByRole("button", { name: "Change the strength" });
        change.focus();
        act(() => { fireEvent.click(change); });
        expect(screen.getByLabelText(/How much of the cleaned sound/)).toBeEnabled();
        expect(screen.getByLabelText(/How much of the cleaned sound/)).toHaveFocus();
        expect(within(screen.getByRole("region", { name: "Chosen file" })).getByText("interview.mp3", { selector: ".ts-file-name" })).toBeInTheDocument();
    });
});
