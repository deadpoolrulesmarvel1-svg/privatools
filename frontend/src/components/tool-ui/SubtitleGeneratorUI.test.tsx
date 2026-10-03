/**
 * What the Subtitle Generator page shows and does: a run from a chosen file
 * to captions to check and download, and each way it can end. Reading the
 * sound and Whisper are stubbed; their own tests are in lib/subtitles.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioChunk } from "@/lib/subtitles/recognize";

const mocks = vi.hoisted(() => ({ open: vi.fn(), load: vi.fn(), stop: vi.fn(), download: vi.fn(), toolRun: vi.fn(), cached: vi.fn() }));
vi.mock("@/lib/subtitles/media/extract", async original => ({ ...(await original<object>()), openAudio: mocks.open }));
vi.mock("@/lib/whisper", async original => ({ ...(await original<object>()), loadWhisper: mocks.load, stopWhisper: mocks.stop }));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), downloadBlob: mocks.download }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));
vi.mock("@/lib/localModels", async original => ({ ...(await original<object>()), listCachedModels: mocks.cached }));

import { MediaError } from "@/lib/subtitles/media/extract";
import { SubtitleGeneratorUI } from "./SubtitleGeneratorUI";

const RATE = 16000;
const voiced = (t: number) => (t >= 0.5 && t < 2.5) || (t >= 3 && t < 6);
/** Two sentences, at 0.5 to 2.5 s and 3 to 6 s, then silence. */
function tone(seconds: number): Float32Array {
    return Float32Array.from({ length: seconds * RATE }, (_, i) => (voiced(i / RATE) ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) : 0));
}
/** The same two sentences every ten seconds, so the windows have somewhere to cut. */
function talk(seconds: number): Float32Array {
    return Float32Array.from({ length: seconds * RATE }, (_, i) => (voiced((i / RATE) % 10) ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) : 0));
}

function source(seconds: number, chunks?: AudioChunk[]) {
    return {
        container: "MP4",
        durationSeconds: seconds,
        chunks: async function* () { for (const chunk of chunks ?? [{ start: 0, samples: tone(seconds) }]) yield chunk; },
    };
}

/** Whisper, stubbed: a sentence for each stretch of sound it is given, timed where the sound is. */
const SENTENCES = [" Welcome to the test.", " Every word should appear."];
const whisper = vi.fn(async (audio: Float32Array) => {
    const frame = RATE / 50;
    const stretches: [number, number][] = [];
    for (let at = 0; at < audio.length; at += frame) {
        if (!audio.subarray(at, at + frame).some(sample => Math.abs(sample) > 0.01)) continue;
        const last = stretches[stretches.length - 1];
        if (last && at / RATE - last[1] < 0.3) last[1] = (at + frame) / RATE;
        else stretches.push([at / RATE, (at + frame) / RATE]);
    }
    return { text: "x", chunks: stretches.map(([start, end], i) => ({ timestamp: [start, end] as [number, number], text: SENTENCES[i] ?? ` Sentence ${i + 1}.` })) };
});

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    whisper.mockClear();
    localStorage.clear();
    mocks.cached.mockResolvedValue([]);
    mocks.load.mockImplementation(async (_size: string, progress: (percent: number) => void) => { progress(100); return whisper; });
});

function choose(name = "talk.mp4", type = "video/mp4") {
    const view = render(<MemoryRouter><SubtitleGeneratorUI /></MemoryRouter>);
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["x"], name, { type })] } });
    return view;
}

const generate = () => fireEvent.click(screen.getByRole("button", { name: /Generate subtitles/ }));

describe("the Subtitle Generator page", () => {
    it("takes the common video and audio containers, and sends nothing until asked", () => {
        const view = render(<MemoryRouter><SubtitleGeneratorUI /></MemoryRouter>);
        const input = view.container.querySelector<HTMLInputElement>("input[type=file]")!;
        expect(input.accept.split(",")).toEqual(expect.arrayContaining([".mp4", ".mov", ".webm", ".mkv", ".mp3", ".m4a", ".wav"]));
        expect(screen.getByRole("button", { name: /Generate subtitles/ })).toBeDisabled();
        fireEvent.change(input, { target: { files: [new File(["x"], "talk.mp4", { type: "video/mp4" })] } });
        expect(within(screen.getByRole("region", { name: "Chosen file" })).getByText("talk.mp4", { selector: ".ts-file-name" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Generate subtitles/ })).toBeEnabled();
        expect(mocks.open).not.toHaveBeenCalled();
        expect(mocks.load).not.toHaveBeenCalled();
    });

    it("offers every Whisper language, English first chosen, and both models with their download size", () => {
        render(<MemoryRouter><SubtitleGeneratorUI /></MemoryRouter>);
        const language = screen.getByLabelText("Language in the file") as HTMLSelectElement;
        expect(language.value).toBe("en");
        expect(language.options.length).toBe(99);
        expect(screen.getByRole("button", { name: /Whisper Base.*Downloads about 74 MB once/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /Whisper Tiny.*Downloads about 41 MB once/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("says a model is already in this browser only when the cache holds it", async () => {
        mocks.cached.mockResolvedValue([{ hfId: "Xenova/whisper-base", bytes: 76 * 1024 * 1024, fileCount: 7 }]);
        render(<MemoryRouter><SubtitleGeneratorUI /></MemoryRouter>);
        expect(await screen.findByRole("button", { name: /Whisper Base.*In this browser \(76 MB\)/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Whisper Tiny.*Downloads about 41 MB once/ })).toBeInTheDocument();
    });

    it("writes captions, lets them be corrected while the file plays, and downloads what they now say", async () => {
        mocks.open.mockResolvedValue(source(20));
        choose();
        fireEvent.change(screen.getByLabelText("Language in the file"), { target: { value: "de" } });
        generate();
        const heading = await screen.findByRole("heading", { level: 2, name: "2 captions written." });
        expect(heading).toHaveFocus();
        expect(whisper).toHaveBeenCalledWith(expect.any(Float32Array), { return_timestamps: true, language: "de", task: "transcribe" }, expect.any(Function));
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "success", files: 1 });
        const captions = within(screen.getByRole("list", { name: "Captions" })).getAllByRole("textbox");
        expect(captions.map(caption => (caption as HTMLTextAreaElement).value)).toEqual(["Welcome to the test.", "Every word should appear."]);
        fireEvent.change(captions[0], { target: { value: "Welcome to the real test." } });
        fireEvent.click(screen.getByRole("button", { name: /Download SRT/ }));
        fireEvent.click(screen.getByRole("button", { name: /Download VTT/ }));
        const [[srt, srtName], [vtt, vttName]] = mocks.download.mock.calls as [Blob, string][];
        expect(srtName).toBe("talk.srt");
        expect(vttName).toBe("talk.vtt");
        expect(await srt.text()).toBe("1\n00:00:00,500 --> 00:00:02,500\nWelcome to the real test.\n\n2\n00:00:03,000 --> 00:00:06,000\nEvery word should appear.\n");
        expect(await vtt.text()).toMatch(/^WEBVTT\n\n00:00:00\.500 --> 00:00:02\.500\nWelcome to the real test\.\n/);
        // Nothing downloads by itself: the captions are checked first.
        expect(mocks.download).toHaveBeenCalledTimes(2);
    });

    it("leaves a cleared caption out of the files", async () => {
        mocks.open.mockResolvedValue(source(20));
        choose();
        generate();
        await screen.findByRole("heading", { level: 2, name: "2 captions written." });
        fireEvent.change(within(screen.getByRole("list", { name: "Captions" })).getAllByRole("textbox")[0], { target: { value: "  " } });
        fireEvent.click(screen.getByRole("button", { name: /Download SRT/ }));
        expect(await (mocks.download.mock.calls[0][0] as Blob).text()).toBe("1\n00:00:03,000 --> 00:00:06,000\nEvery word should appear.\n");
    });

    it("says plainly when a video has no sound track, and offers no retry", async () => {
        mocks.open.mockRejectedValue(new MediaError("no-sound", "This file has no sound track, so there is nothing to subtitle."));
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "This file has no sound track." })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
        expect(mocks.load).not.toHaveBeenCalled();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "bad_input" }, expect.any(MediaError));
    });

    it("points a video this browser can't read to Extract Audio, saying that it uploads", async () => {
        mocks.open.mockRejectedValue(new MediaError("unreadable", "This browser can’t decode the sound in this file."));
        choose("clip.mkv", "video/x-matroska");
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "This browser can’t read the sound in this file." })).toBeInTheDocument();
        expect(screen.getByText("Nothing was sent anywhere.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Extract Audio" })).toHaveAttribute("href", "/tools/extract-audio");
        expect(screen.getByText(/can save its sound as an MP3 on the PrivaTools server, which means uploading the video for temporary processing; the MP3 then works here, up to 3 hours/)).toBeInTheDocument();
        expect(mocks.load).not.toHaveBeenCalled();
    });

    it("offers a helper only when it takes the file, by its type and size", async () => {
        mocks.open.mockRejectedValue(new MediaError("unreadable", "This browser can’t decode the sound in this file."));
        // Extract Audio takes no .m4v, and Audio Converter no .opus.
        choose("clip.m4v", "video/mp4");
        generate();
        await screen.findByRole("heading", { level: 2, name: "This browser can’t read the sound in this file." });
        expect(screen.queryByRole("link", { name: "Extract Audio" })).toBeNull();
        expect(screen.getByText(/A video or audio app on your device can save it as MP4 or MP3, which work here up to 3 hours/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Choose a different file" }));
    });

    it("says why a long fragmented MP4 is refused, and points it to Extract Audio, not Audio Converter", async () => {
        mocks.open.mockRejectedValue(new MediaError("too-long-whole", "This file’s sound is 16 minutes long. This file is written in fragments, as some recorders save video, which this browser decodes whole, up to 15 minutes of sound.", 960));
        choose("obs.mp4", "video/mp4");
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "This file is too long to read whole." })).toBeInTheDocument();
        expect(screen.getByText(/written in fragments/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Extract Audio" })).toHaveAttribute("href", "/tools/extract-audio");
        expect(screen.queryByRole("link", { name: "Audio Converter" })).toBeNull();
    });

    it("says an empty file is empty", async () => {
        mocks.open.mockRejectedValue(new MediaError("empty", "This file is empty, so there is no sound in it."));
        choose("empty.mp3", "audio/mpeg");
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "This file is empty." })).toBeInTheDocument();
        expect(screen.queryByRole("link")).toBeNull();
        expect(mocks.stop).not.toHaveBeenCalled();
    });

    it("refuses sound longer than three hours before fetching the model", async () => {
        mocks.open.mockRejectedValue(new MediaError("too-long", "This file’s sound is 4 h 10 min long. Subtitle Generator takes up to 3 hours at a time.", 15000));
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "This file is too long to subtitle here." })).toBeInTheDocument();
        expect(screen.getByText(/4 h 10 min long/)).toBeInTheDocument();
        expect(mocks.load).not.toHaveBeenCalled();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "too_large" }, expect.any(MediaError));
    });

    it("offers another try when the model download drops, and the try works", async () => {
        mocks.open.mockImplementation(async () => source(20));
        mocks.load.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "Whisper couldn’t be downloaded." })).toBeInTheDocument();
        expect(screen.getByText(/The connection dropped/)).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "network" }, expect.any(TypeError));
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("heading", { level: 2, name: "2 captions written." })).toBeInTheDocument();
    });

    it("says when no speech was heard, and offers the language and model again", async () => {
        mocks.open.mockResolvedValue(source(20));
        mocks.load.mockImplementation(async () => async () => ({ text: "", chunks: [] }));
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "No speech was found." })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Change the language or model" }));
        expect(screen.getByLabelText("Language in the file")).toBeInTheDocument();
        expect(within(screen.getByRole("region", { name: "Chosen file" })).getByText("talk.mp4", { selector: ".ts-file-name" })).toBeInTheDocument();
    });

    it("stops when asked, keeps what was written, and counts nothing", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let calls = 0;
        mocks.open.mockResolvedValue(source(95, [{ start: 0, samples: talk(95) }]));
        mocks.load.mockImplementation(async () => async (audio: Float32Array) => {
            calls++;
            if (calls === 2) await gate;
            return whisper(audio);
        });
        choose();
        generate();
        await screen.findByRole("button", { name: "Stop and keep what’s done" });
        await waitFor(() => expect(calls).toBe(2));
        fireEvent.click(screen.getByRole("button", { name: "Stop and keep what’s done" }));
        expect(screen.getByText("Stopping after this stretch")).toBeInTheDocument();
        await act(async () => { release(); });
        const heading = await screen.findByRole("heading", { level: 2, name: /^Subtitles for the first / });
        expect(heading.closest("[data-tone]")).toHaveAttribute("data-tone", "partial");
        expect(screen.getByText(/so the rest has no captions/)).toBeInTheDocument();
        expect(calls).toBe(2);
        expect(mocks.toolRun).not.toHaveBeenCalled();
    });

    it("shows a stretch the browser couldn't decode as a partial result", async () => {
        mocks.open.mockResolvedValue(source(130, [
            { start: 0, samples: tone(60) },
            { start: 60, unreadableSeconds: 60 },
            { start: 120, samples: tone(10) },
        ]));
        choose();
        generate();
        const heading = await screen.findByRole("heading", { level: 2, name: "Subtitles, with a gap." });
        expect(heading.closest("[data-tone]")).toHaveAttribute("data-tone", "partial");
        expect(screen.getByText(/couldn’t decode 1:00 of the sound \(1:00–2:00\)/)).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "partial", files: 1, errorKind: "browser" });
    });

    it("leaves out a stretch Whisper wrote as a loop, and says where it was", async () => {
        const loop = ` ${Array.from({ length: 30 }, () => "the option to be").join(" ")}`;
        mocks.open.mockResolvedValue(source(20));
        // The window, then its first half, loop; its second half is silence.
        let calls = 0;
        mocks.load.mockImplementation(async () => async () => (++calls <= 2 ? { text: "x", chunks: [
            { timestamp: [0.5, 2.5] as [number, number], text: " Welcome to the test." },
            { timestamp: [3, 6] as [number, number], text: loop },
        ] } : { text: "", chunks: [] }));
        choose();
        generate();
        const heading = await screen.findByRole("heading", { level: 2, name: "Subtitles, with a gap." });
        expect(heading.closest("[data-tone]")).toHaveAttribute("data-tone", "partial");
        expect(screen.getByText(/Whisper wrote the same words over and over at 0:03–0:06, so they were left out/)).toBeInTheDocument();
        const captions = within(screen.getByRole("list", { name: "Captions" })).getAllByRole("textbox");
        expect(captions.map(caption => (caption as HTMLTextAreaElement).value)).toEqual(["Welcome to the test."]);
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "partial", files: 1, errorKind: "browser" });
    });

    it("says Whisper couldn't make out the words when all it wrote was a loop", async () => {
        const loop = ` ${Array.from({ length: 30 }, () => "the option to be").join(" ")}`;
        mocks.open.mockResolvedValue(source(20));
        mocks.load.mockImplementation(async () => async () => ({ text: "x", chunks: [{ timestamp: [0.5, 6] as [number, number], text: loop }] }));
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "Whisper couldn’t make out the words." })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(screen.getByRole("button", { name: "Change the language or model" })).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "browser" });
    });

    it("stops Whisper when a run fails, so the next run gets a new worker", async () => {
        mocks.open.mockResolvedValue(source(20));
        mocks.load.mockImplementation(async () => async () => { throw new Error("session run failed"); });
        choose();
        generate();
        expect(await screen.findByRole("heading", { level: 2, name: "Subtitles couldn’t be made." })).toBeInTheDocument();
        expect(mocks.stop).toHaveBeenCalled();
    });

    it("stops Whisper when the page closes mid-run", async () => {
        mocks.open.mockResolvedValue(source(95, [{ start: 0, samples: talk(95) }]));
        mocks.load.mockImplementation(async () => () => new Promise(() => {}));
        const view = choose();
        generate();
        await screen.findByRole("button", { name: "Stop and keep what’s done" });
        expect(mocks.stop).not.toHaveBeenCalled();
        view.unmount();
        expect(mocks.stop).toHaveBeenCalled();
    });

    it("stops the model download with Cancel", async () => {
        mocks.open.mockResolvedValue(source(20));
        mocks.load.mockImplementation(() => new Promise(() => {}));
        choose();
        generate();
        await screen.findByText("Downloading Whisper Base");
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mocks.stop).toHaveBeenCalled();
        expect(screen.getByRole("button", { name: /Generate subtitles/ })).toBeEnabled();
    });

    it("chooses Whisper Tiny first on a phone-sized screen", () => {
        const matchMedia = vi.fn((query: string) => ({ matches: query === "(max-width: 560px)", media: query, addEventListener() {}, removeEventListener() {} }));
        vi.stubGlobal("matchMedia", matchMedia);
        try {
            render(<MemoryRouter><SubtitleGeneratorUI /></MemoryRouter>);
            expect(screen.getByRole("button", { name: /Whisper Tiny/ })).toHaveAttribute("aria-pressed", "true");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("links the burn-in tool and says what it uploads", async () => {
        mocks.open.mockResolvedValue(source(20));
        choose();
        generate();
        await screen.findByRole("heading", { level: 2, name: "2 captions written." });
        expect(screen.getByRole("link", { name: "Add Subtitles" })).toHaveAttribute("href", "/tools/add-subtitles");
        expect(screen.getByText(/which means uploading the video and the subtitles to PrivaTools for temporary processing/)).toBeInTheDocument();
    });
});
