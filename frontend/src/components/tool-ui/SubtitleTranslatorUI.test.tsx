/**
 * What the Subtitle Translator page shows and does: a file read on this
 * device, a run with either translator, the check beside the original, the
 * downloads and the ways a run can end. The on-device model is stubbed; the
 * provider is a stubbed fetch behind the real BYOK client and key store.
 * The translation logic itself is tested in lib/subtitles.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { saveKey } from "@/lib/byok/keyStore";
import { documentNavigationFor } from "@/skins/cspRoutes";

const mocks = vi.hoisted(() => ({ load: vi.fn(), download: vi.fn(), toolRun: vi.fn(), cached: vi.fn(), handoff: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/translate/opusMt", async original => ({ ...(await original<object>()), loadDeviceTranslator: mocks.load }));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), downloadBlob: mocks.download }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));
vi.mock("@/lib/localModels", async original => ({ ...(await original<object>()), listCachedModels: mocks.cached }));
vi.mock("@/lib/file-handoff", () => ({ storeFileHandoff: mocks.handoff, consumeFileHandoffs: vi.fn(async () => []), consumeFileHandoff: vi.fn(async () => null) }));
vi.mock("@/lib/navigation", async original => ({ ...(await original<object>()), navigateTo: mocks.navigate }));

import { SubtitleTranslatorUI } from "./SubtitleTranslatorUI";

const TALK = `1
00:00:01,000 --> 00:00:03,200
Welcome back to the workshop.

2
00:00:03,400 --> 00:00:05,900
Today we're going to look at

3
00:00:06,000 --> 00:00:08,500
how to keep your files private.

4
00:00:09,000 --> 00:00:11,500
- Can I translate subtitles here?
- Yes, right in this browser.

5
00:00:12,000 --> 00:00:14,500
<i>Every timing stays where it was.</i>
`;

const SPANISH: Record<string, string> = {
    "Welcome back to the workshop.": "Bienvenidos de nuevo al taller.",
    "Today we're going to look at how to keep your files private.": "Hoy vamos a ver cómo mantener privados tus archivos.",
    "Can I translate subtitles here?": "¿Puedo traducir subtítulos aquí?",
    "Yes, right in this browser.": "Sí, en este mismo navegador.",
    "Every timing stays where it was.": "Cada tiempo se queda donde estaba.",
};

/** OPUS-MT, stubbed: a word a token, Spanish for the talk above. */
const translator = { modelId: "Xenova/opus-mt-en-es", countTokens: (text: string) => text.split(/\s+/).length + 1, translate: vi.fn(async (text: string) => SPANISH[text] ?? text) };

beforeEach(async () => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    translator.translate.mockClear();
    mocks.cached.mockResolvedValue([]);
    mocks.handoff.mockResolvedValue(true);
    mocks.load.mockImplementation(async (_id: string, progress: (percent: number) => void) => { progress(100); return translator; });
    _resetForTests();
    await db.clear("secrets");
    localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function choose(text: string | Uint8Array<ArrayBuffer> = TALK, name = "talk.srt") {
    const view = render(<SubtitleTranslatorUI />);
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File([text], name, { type: "application/x-subrip" })] } });
    return view;
}

const translateButton = () => screen.getByRole("button", { name: "Translate" });

async function translateOnDevice() {
    choose();
    await screen.findByText(/SRT · 5 cues/);
    fireEvent.click(translateButton());
    return screen.findByRole("heading", { name: "5 cues translated." });
}

describe("choosing a file", () => {
    it("takes SRT and VTT, reads the file on this device and sends nothing until asked", async () => {
        const fetch = vi.spyOn(globalThis, "fetch");
        const view = render(<SubtitleTranslatorUI />);
        const input = view.container.querySelector<HTMLInputElement>("input[type=file]")!;
        expect(input.accept).toBe(".srt,.vtt");
        expect(translateButton()).toBeDisabled();
        fireEvent.change(input, { target: { files: [new File([TALK], "talk.srt", { type: "application/x-subrip" })] } });
        expect(await screen.findByText(/^[\d.]+ (?:B|KB) · SRT · 5 cues · read on this device$/)).toBeInTheDocument();
        expect(translateButton()).toBeEnabled();
        expect(mocks.load).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("names the line of a timing it can't read, and translates nothing", async () => {
        choose("1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:02,500 -> 00:00:03,000\nTwo\n", "broken.srt");
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Line 6 isn’t a valid timing line.");
        expect(alert).toHaveTextContent("“00:00:02,500 -> 00:00:03,000”");
        expect(translateButton()).toBeDisabled();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1 }, expect.objectContaining({ __kind: "bad_input" }));
    });

    it("refuses a file in an older encoding, and sends an ASS file to Subtitle Converter", async () => {
        choose(Uint8Array.from([0x31, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30, 0x30, 0x20, 0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x32, 0x2c, 0x30, 0x30, 0x30, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]), "old.srt");
        expect(await screen.findByRole("alert")).toHaveTextContent("old.srt isn’t saved as UTF-8 or UTF-16.");
        cleanup();
        choose("[Script Info]\nTitle: x\n", "song.srt");
        const alert = await screen.findByRole("alert");
        expect(within(alert).getByRole("link", { name: "Open Subtitle Converter" })).toHaveAttribute("href", "/tools/subtitle-converter");
    });

    it("reads UTF-16 and says so", async () => {
        const units = Array.from("﻿" + TALK, ch => ch.charCodeAt(0));
        const bytes = new Uint8Array(units.length * 2);
        units.forEach((unit, i) => { bytes[i * 2] = unit & 0xff; bytes[i * 2 + 1] = unit >> 8; });
        choose(bytes);
        expect(await screen.findByText(/SRT · 5 cues · UTF-16LE · read on this device/)).toBeInTheDocument();
    });

    it("sets the source from a file's letters, and points to your own key for a pair the device can't do", async () => {
        choose("1\n00:00:01,000 --> 00:00:02,000\n今日はプライバシーについて話します。\n", "talk.ja.srt");
        expect(await screen.findByText(/Its letters are Japanese, so it will be translated from Japanese/)).toBeInTheDocument();
        expect(screen.getByLabelText("From")).toHaveValue("ja");
        expect(screen.getByLabelText("Into")).toHaveValue("en");
        expect(screen.getByText(/On this device Japanese translates into English only/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Use my own AI key" }));
        expect(screen.getByRole("button", { name: /Your own AI key/ })).toHaveAttribute("aria-pressed", "true");
    });
});

describe("the language each file is in", () => {
    const CHINESE = "1\n00:00:01,000 --> 00:00:02,000\n今天我们来谈谈隐私和你的文件。\n";
    const file = (text: string, name: string) => ({ target: { files: [new File([text], name, { type: "application/x-subrip" })] } });
    const from = () => screen.getByLabelText<HTMLSelectElement>("From");
    const into = () => screen.getByLabelText<HTMLSelectElement>("Into");
    /** Settings are saved 400 ms after a change, and a page closed sooner saves nothing: what a reload finds after that. */
    const saved = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 450)));

    it("guesses each file's language from its own letters: an English file after a Chinese one is English again, into the language chosen before", async () => {
        const view = render(<SubtitleTranslatorUI />);
        const input = () => view.container.querySelector("input[type=file]")!;
        fireEvent.change(into(), { target: { value: "fr" } });
        fireEvent.change(input(), file(CHINESE, "chinese.srt"));
        expect(await screen.findByText("Its letters are Chinese, so it will be translated from Chinese. Change “From” if that’s wrong.")).toBeInTheDocument();
        expect(from()).toHaveValue("zh");
        expect(into()).toHaveValue("en");

        fireEvent.click(screen.getByRole("button", { name: "Remove chinese.srt" }));
        fireEvent.change(input(), file(TALK, "talk.srt"));
        await screen.findByText(/SRT · 5 cues/);
        expect(from()).toHaveValue("en");
        expect(into()).toHaveValue("fr");
        expect(screen.queryByText(/Its letters/)).toBeNull();
        fireEvent.click(translateButton());
        await screen.findByRole("heading", { name: "5 cues translated." });
        expect(mocks.load).toHaveBeenCalledWith("Xenova/opus-mt-en-fr", expect.any(Function));
    });

    it("doesn't keep a file's guessed language for the next visit", async () => {
        choose(CHINESE, "chinese.srt");
        expect(await screen.findByText(/Its letters are Chinese/)).toBeInTheDocument();
        await saved();
        cleanup();
        render(<SubtitleTranslatorUI />);
        expect(from()).toHaveValue("en");
        expect(into()).toHaveValue("es");
    });

    it("puts a remembered language the letters contradict back to English, and says so", async () => {
        const view = render(<SubtitleTranslatorUI />);
        fireEvent.change(from(), { target: { value: "ja" } });
        await saved();
        cleanup();
        // The next visit: Japanese is remembered, and the file is in English.
        const next = render(<SubtitleTranslatorUI />);
        expect(from()).toHaveValue("ja");
        fireEvent.change(next.container.querySelector("input[type=file]")!, file(TALK, "talk.srt"));
        expect(await screen.findByText("Its letters aren’t Japanese, so it will be translated from English. Change “From” if that’s wrong.")).toBeInTheDocument();
        expect(from()).toHaveValue("en");
        expect(into()).toHaveValue("es");
        expect(view.container).toBeEmptyDOMElement();
    });

    it("lets a confident guess override a remembered language only with a note, and a choice made for the file ends the note", async () => {
        const view = render(<SubtitleTranslatorUI />);
        fireEvent.change(from(), { target: { value: "ja" } });
        fireEvent.change(view.container.querySelector("input[type=file]")!, file(CHINESE, "chinese.srt"));
        expect(await screen.findByText("Its letters are Chinese, so it will be translated from Chinese. Change “From” if that’s wrong.")).toBeInTheDocument();
        expect(from()).toHaveValue("zh");
        fireEvent.change(from(), { target: { value: "ja" } });
        expect(from()).toHaveValue("ja");
        expect(screen.queryByText(/Its letters/)).toBeNull();
    });

    it("says which language it will use when the letters can't tell it from English", async () => {
        const view = render(<SubtitleTranslatorUI />);
        fireEvent.change(from(), { target: { value: "es" } });
        fireEvent.change(view.container.querySelector("input[type=file]")!, file(TALK, "talk.srt"));
        expect(await screen.findByText("Its letters don’t say which language it’s in, so it will be translated from Spanish, as “From” says. Change it if that’s wrong.")).toBeInTheDocument();
        expect(from()).toHaveValue("es");
        expect(into()).toHaveValue("en");
    });
});

describe("translating on this device", () => {
    it("translates a sentence across cues together, keeps every timing, and saves SRT and VTT named with the language", async () => {
        await translateOnDevice();
        expect(mocks.load).toHaveBeenCalledWith("Xenova/opus-mt-en-es", expect.any(Function));
        expect(translator.translate.mock.calls.map(call => call[0])).toEqual(Object.keys(SPANISH));
        expect(screen.getByText(/^Machine translation from English into Spanish, on this device\./)).toBeInTheDocument();
        const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
        expect(boxes[0]).toHaveValue("Bienvenidos de nuevo al taller.");
        expect(`${boxes[1].value} ${boxes[2].value}`).toBe("Hoy vamos a ver cómo mantener privados tus archivos.");
        expect(boxes[3]).toHaveValue("- ¿Puedo traducir subtítulos aquí?\n- Sí, en este mismo navegador.");
        expect(boxes[4]).toHaveValue("<i>Cada tiempo se queda donde estaba.</i>");
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "success", files: 1 });

        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        const [srt, srtName] = mocks.download.mock.calls[0] as [Blob, string];
        expect(srtName).toBe("talk.es.srt");
        const written = await srt.text();
        for (const timing of TALK.split("\n").filter(line => line.includes("-->"))) expect(written).toContain(timing);
        expect(written.split("\n").filter(line => /^\d+$/.test(line))).toEqual(["1", "2", "3", "4", "5"]);

        fireEvent.click(screen.getByRole("button", { name: "Download VTT" }));
        const [vtt, vttName] = mocks.download.mock.calls[1] as [Blob, string];
        expect(vttName).toBe("talk.es.vtt");
        expect(await vtt.text()).toMatch(/^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:03\.200\nBienvenidos de nuevo al taller\.\n/);
    });

    it("keeps a correction in the file it saves, once the box is left or typing pauses", async () => {
        await translateOnDevice();
        const box = screen.getAllByRole("textbox")[0];
        fireEvent.change(box, { target: { value: "¡Bienvenidos otra vez!" } });
        // Pressing a button takes the focus from the box first.
        fireEvent.blur(box);
        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        expect(await (mocks.download.mock.calls[0][0] as Blob).text()).toMatch(/^1\n00:00:01,000 --> 00:00:03,200\n¡Bienvenidos otra vez!\n/);
        // Without leaving the box: the correction is kept once typing pauses.
        fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "Hoy veremos" } });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        expect(await (mocks.download.mock.calls[1][0] as Blob).text()).toContain("00:00:03,400 --> 00:00:05,900\nHoy veremos\n");
    });

    it("saves a UTF-16 file as UTF-8, and says so", async () => {
        const units = Array.from("﻿" + TALK, ch => ch.charCodeAt(0));
        const bytes = new Uint8Array(units.length * 2);
        units.forEach((unit, i) => { bytes[i * 2] = unit & 0xff; bytes[i * 2 + 1] = unit >> 8; });
        choose(bytes);
        await screen.findByText(/SRT · 5 cues · UTF-16LE/);
        fireEvent.click(translateButton());
        await screen.findByRole("heading", { name: "5 cues translated." });
        expect(screen.getByText(/Both are saved as UTF-8 rather than UTF-16LE, the only encoding WebVTT allows and the one players expect\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        const saved = new Uint8Array(await (mocks.download.mock.calls[0][0] as Blob).arrayBuffer());
        expect(Array.from(saved.subarray(0, 4))).toEqual([0xef, 0xbb, 0xbf, 0x31]);
    });

    it("counts the cues that repeat the line before among the notes", async () => {
        // One word back for a sentence across two cues: the second cue can only repeat it.
        translator.translate.mockImplementation(async (text: string) => (text.startsWith("Today") ? "Hoy." : SPANISH[text] ?? text));
        await translateOnDevice();
        expect(screen.getAllByText("Repeats the line before")).toHaveLength(1);
        expect(screen.getByText("1 cue repeats the line before it: the translation came back with fewer words than its cues, so read it beside the original.")).toBeInTheDocument();
    });

    it.each([
        ["Change the languages", "Changing the languages starts a new translation", "Change the languages anyway"],
        ["Translate another file", "Another file starts afresh", "Choose another file anyway"],
    ])("warns before “%s” loses corrections that aren't in a downloaded file", async (button, warning, anyway) => {
        await translateOnDevice();
        // Nothing corrected: nothing to lose but the run.
        fireEvent.click(screen.getByRole("button", { name: button }));
        expect(screen.queryByRole("heading", { name: "5 cues translated." })).toBeNull();
        cleanup();

        await translateOnDevice();
        const box = screen.getAllByRole("textbox")[0];
        fireEvent.change(box, { target: { value: "¡Bienvenidos otra vez!" } });
        fireEvent.blur(box);
        fireEvent.click(screen.getByRole("button", { name: button }));
        expect(screen.getByRole("alert")).toHaveTextContent(`${warning}, and your correction would be lost: it isn’t in a downloaded file yet.`);
        fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getAllByRole("textbox")[0]).toHaveValue("¡Bienvenidos otra vez!");

        fireEvent.click(screen.getByRole("button", { name: button }));
        fireEvent.click(screen.getByRole("button", { name: anyway }));
        expect(screen.queryByRole("heading", { name: "5 cues translated." })).toBeNull();
    });

    it("lets the keyboard skip the check's boxes to the downloads", async () => {
        await translateOnDevice();
        const skip = screen.getByRole("button", { name: "Skip to the downloads" });
        // Before the check's first box in the tab order, and the downloads after its last.
        const [first] = screen.getAllByRole("textbox");
        expect(skip.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(skip);
        expect(screen.getByRole("button", { name: "Download SRT" })).toHaveFocus();
    });

    it("doesn't warn once the corrections are in a downloaded file", async () => {
        await translateOnDevice();
        const box = screen.getAllByRole("textbox")[0];
        fireEvent.change(box, { target: { value: "¡Bienvenidos otra vez!" } });
        fireEvent.blur(box);
        fireEvent.click(screen.getByRole("button", { name: "Download VTT" }));
        fireEvent.click(screen.getByRole("button", { name: "Change the languages" }));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByLabelText("From")).toHaveValue("en");
    });

    it("hands the translated SRT to Add Subtitles in this same page", async () => {
        await translateOnDevice();
        fireEvent.click(screen.getByRole("button", { name: "Burn into a video" }));
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/tools/add-subtitles"));
        const [file, target] = mocks.handoff.mock.calls[0] as [File, string];
        expect([file.name, target]).toEqual(["talk.es.srt", "add-subtitles"]);
        expect(await file.text()).toContain("Bienvenidos de nuevo al taller.");
        // The page that holds the file can show Add Subtitles: no new document, so the file survives.
        expect(documentNavigationFor("/tools/subtitle-translator", "/tools/add-subtitles")).toBeNull();
    });

    it("says when the model can't be downloaded, and offers to try again", async () => {
        mocks.load.mockRejectedValueOnce(Object.assign(new TypeError("Failed to fetch")));
        choose();
        await screen.findByText(/SRT · 5 cues/);
        fireEvent.click(translateButton());
        expect(await screen.findByRole("heading", { name: "The translation model couldn’t be downloaded." })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("heading", { name: "5 cues translated." })).toBeInTheDocument();
    });

    it("goes back to the options when cancelled, with no result", async () => {
        let release!: () => void;
        translator.translate.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve("x"); }));
        choose();
        await screen.findByText(/SRT · 5 cues/);
        fireEvent.click(translateButton());
        const cancel = await screen.findByRole("button", { name: "Cancel" });
        await screen.findByText("Translating your subtitles");
        fireEvent.click(cancel);
        await act(async () => { release(); });
        expect(screen.queryByRole("heading", { name: /translated\./ })).toBeNull();
        expect(translateButton()).toBeEnabled();
        expect(mocks.toolRun).not.toHaveBeenCalled();
    });
});

/** Each numbered line "translated", a speaker's dash kept in front as models keep it. */
const echo = (lines: [number, string][]) => lines.map(([n, text]) => `[${n}] ${text.replace(/^(- )?/, "$1ES ")}`).join("\n");

/** A provider that answers each numbered line, as Claude would; `answer` can change a reply. */
function anthropic(answer: (lines: [number, string][], call: number) => string = echo) {
    let calls = 0;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const lines = [...String(body.messages[0].content).matchAll(/^\[(\d+)\] (.*)$/gm)].map(m => [Number(m[1]), m[2]] as [number, string]);
        const text = answer(lines, ++calls);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn" }), text: async () => "" } as unknown as Response;
    });
}

async function translateWithKey(into = "German") {
    localStorage.setItem("privatools.byok.provider", "anthropic");
    await saveKey("anthropic", "dummy-key-for-tests");
    choose();
    await screen.findByText(/SRT · 5 cues/);
    fireEvent.click(screen.getByRole("button", { name: /Your own AI key/ }));
    fireEvent.change(screen.getByLabelText("Translate into"), { target: { value: into } });
    await waitFor(() => expect(translateButton()).toBeEnabled());
    fireEvent.click(translateButton());
}

describe("translating with your own AI key", () => {
    it("sends the numbered lines and puts each reply back on its own cue", async () => {
        const fetch = anthropic();
        await translateWithKey();
        expect(await screen.findByRole("heading", { name: "5 cues translated." })).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/^Machine translation into German, with your Anthropic \(Claude\) key\./)).toBeInTheDocument();
        const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
        expect(boxes.map(box => box.value)).toEqual([
            "ES Welcome back to the workshop.", "ES Today we're going to look at", "ES how to keep your files private.",
            "- ES Can I translate subtitles here?\n- ES Yes, right in this browser.", "<i>ES Every timing stays where it was.</i>",
        ]);
        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        expect(mocks.download.mock.calls[0][1]).toBe("talk.de.srt");
    });

    it("marks the cues of a batch whose replies never matched, says how many, and translates them again on request", async () => {
        // The first reply, and the retry of the half holding "Today…", merge two lines into one.
        anthropic((lines, call) => call <= 2 && lines.some(([, text]) => text.startsWith("Today")) ? "[1] Bienvenidos.\n[2] Hoy vamos a ver cómo mantener privados tus archivos." : echo(lines));
        await translateWithKey();
        expect(await screen.findByRole("heading", { name: "2 of 5 cues translated." })).toBeInTheDocument();
        expect(screen.getAllByText("Not translated", { selector: ".st-mark" })).toHaveLength(3);
        expect(screen.getByText(/In both, the 3 cues that weren’t translated keep their original text\./)).toBeInTheDocument();
        const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
        expect(boxes.slice(0, 3).map(box => box.value)).toEqual(["Welcome back to the workshop.", "Today we're going to look at", "how to keep your files private."]);
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "partial", files: 1, errorKind: "provider" }, undefined);
        fireEvent.click(screen.getByRole("button", { name: "Translate the 3 marked cues again" }));
        expect(await screen.findByRole("heading", { name: "5 cues translated." })).toBeInTheDocument();
        expect((screen.getAllByRole("textbox") as HTMLTextAreaElement[]).slice(0, 3).map(box => box.value))
            .toEqual(["ES Welcome back to the workshop.", "ES Today we're going to look at", "ES how to keep your files private."]);
    });

    it("leaves a cue corrected by hand alone when the marked cues are translated again", async () => {
        anthropic((lines, call) => call <= 2 && lines.some(([, text]) => text.startsWith("Today")) ? "[1] Uno" : echo(lines));
        await translateWithKey();
        await screen.findByRole("heading", { name: "2 of 5 cues translated." });
        fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Willkommen zurück." } });
        fireEvent.blur(screen.getAllByRole("textbox")[0]);
        fireEvent.click(await screen.findByRole("button", { name: "Translate the 2 marked cues again" }));
        await screen.findByRole("heading", { name: "5 cues translated." });
        expect((screen.getAllByRole("textbox") as HTMLTextAreaElement[]).slice(0, 3).map(box => box.value))
            .toEqual(["Willkommen zurück.", "ES Today we're going to look at", "ES how to keep your files private."]);
    });

    it("shows only the marked cues on request, and keeps a cue in view while it is corrected", async () => {
        anthropic((lines, call) => call <= 2 && lines.some(([, text]) => text.startsWith("Today")) ? "[1] Uno" : echo(lines));
        await translateWithKey();
        await screen.findByRole("heading", { name: "2 of 5 cues translated." });
        fireEvent.click(screen.getByRole("checkbox", { name: "Show only the 3 marked cues" }));
        expect(screen.getAllByRole("textbox")).toHaveLength(3);
        const box = screen.getAllByRole("textbox")[0];
        fireEvent.change(box, { target: { value: "Willkommen zurück." } });
        fireEvent.blur(box);
        // Corrected, it is no longer marked, but it stays where the visitor is working.
        expect(screen.getAllByRole("textbox")).toHaveLength(3);
        expect(screen.getAllByRole("textbox")[0]).toHaveValue("Willkommen zurück.");
        expect(screen.getByRole("heading", { name: "3 of 5 cues translated." })).toBeInTheDocument();
    });

    it("pages a long file's check 500 cues at a time, and saves every cue", async () => {
        anthropic();
        localStorage.setItem("privatools.byok.provider", "anthropic");
        await saveKey("anthropic", "dummy-key-for-tests");
        const long = Array.from({ length: 1200 }, (_, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, "0")},000 --> 00:00:${String(i % 60).padStart(2, "0")},500\nLine ${i + 1}.\n`).join("\n");
        choose(long, "long.srt");
        await screen.findByText(/SRT · 1,200 cues/);
        fireEvent.click(screen.getByRole("button", { name: /Your own AI key/ }));
        await waitFor(() => expect(translateButton()).toBeEnabled());
        fireEvent.click(translateButton());
        await screen.findByRole("heading", { name: "1,200 cues translated." }, { timeout: 15000 });
        expect(screen.getAllByRole("textbox")).toHaveLength(500);
        expect(screen.getByText("Cues 1–500 of 1,200")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Next 500" }));
        expect(screen.getByText("Cues 501–1,000 of 1,200")).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: /^Translation of cue 501,/ })).toHaveValue("ES Line 501.");
        fireEvent.click(screen.getByRole("button", { name: "Next 200" }));
        expect(screen.getAllByRole("textbox")).toHaveLength(200);
        fireEvent.click(screen.getByRole("button", { name: "Download SRT" }));
        const written = await (mocks.download.mock.calls[0][0] as Blob).text();
        expect(written.split("\n").filter(line => line.includes("-->"))).toHaveLength(1200);
        expect(written).toContain("\nES Line 1200.\n");
    }, 30000);

    it("doesn't offer to burn in a language the server has no font for, and says why", async () => {
        anthropic();
        await translateWithKey("Japanese");
        await screen.findByRole("heading", { name: "5 cues translated." });
        expect(screen.queryByRole("button", { name: "Burn into a video" })).toBeNull();
        expect(screen.getByText(/Add Subtitles can’t burn Japanese into a video: it draws subtitles with the DejaVu fonts/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Download VTT" }));
        expect(mocks.download.mock.calls[0][1]).toBe("talk.ja.vtt");
    });

    it("says the model declined when it declined every batch, not that the numbering failed", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ content: [], stop_reason: "refusal" }), text: async () => "" } as unknown as Response));
        await translateWithKey();
        expect(await screen.findByRole("heading", { name: "Anthropic (Claude) didn’t translate the subtitles." })).toBeInTheDocument();
        expect(screen.getByText(/Claude declined to answer this request/)).toBeInTheDocument();
        expect(screen.queryByText(/didn’t keep each line’s number/)).toBeNull();
    });

    it("says the key was rejected, and translates nothing", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, json: async () => ({}), text: async () => "{}" } as unknown as Response);
        await translateWithKey();
        expect(await screen.findByRole("heading", { name: "Anthropic (Claude) didn’t translate the subtitles." })).toBeInTheDocument();
        expect(screen.getByText(/That key was rejected/)).toBeInTheDocument();
        expect(mocks.toolRun).toHaveBeenCalledWith({ outcome: "error", files: 1, errorKind: "provider" }, expect.objectContaining({ kind: "BadKey" }));
    });
});
