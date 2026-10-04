/**
 * Transcribe Audio on this device: the spoken language reaches Whisper, and
 * Cancel or closing the page stops Whisper rather than leaving it to finish
 * a recording nobody waits for. Decoding and Whisper are stubbed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ decode: vi.fn(), load: vi.fn(), stop: vi.fn(), toolRun: vi.fn() }));
// A saved key for whichever provider a test picks; the key is a dummy.
const byok = vi.hoisted(() => ({ provider: "together" }));
vi.mock("@/lib/whisper", async original => ({ ...(await original<object>()), decodeToMono: mocks.decode, loadWhisper: mocks.load, stopWhisper: mocks.stop }));
vi.mock("@/lib/toolRun", async original => ({ ...(await original<object>()), emitToolRun: mocks.toolRun }));
vi.mock("@/lib/file-handoff", () => ({ consumeFileHandoff: vi.fn(async () => null), consumeFileHandoffs: vi.fn(async () => []) }));
vi.mock("@/hooks/useByok", () => ({
    useByok: () => ({ loading: false, configured: [byok.provider], provider: byok.provider, ready: true, sessionOnly: false,
        selectProvider: vi.fn(), save: vi.fn(), forget: vi.fn(), setSession: vi.fn() }),
}));
// The key panel itself is tested on its own; here, what the page asks of it.
const panel = vi.hoisted(() => ({ props: undefined as undefined | { offers?: (p: { id: string }) => boolean } }));
vi.mock("@/components/byok/ByokPanel", () => ({ ByokPanel: (props: typeof panel.props) => { panel.props = props; return null; } }));
vi.mock("@/lib/byok/keyStore", () => ({ getKey: vi.fn(async () => "dummy-key-value"), getBaseUrl: vi.fn(() => undefined) }));

import { PROVIDERS } from "@/lib/byok/providers";
import { TranscribeAudioUI } from "./TranscribeAudioUI";

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.decode.mockResolvedValue(new Float32Array(16000));
    vi.restoreAllMocks();
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

describe("Transcribe Audio with your own key", () => {
    function startWithKey(provider: string) {
        byok.provider = provider;
        const view = start();
        fireEvent.click(screen.getByRole("button", { name: /^My own API key/ }));
        return view;
    }

    it("sends Together its own transcription model, not whisper-1", async () => {
        const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ text: "Hello from a synthetic recording." })));
        startWithKey("together");
        expect(screen.getByLabelText("Model (optional)")).toHaveAttribute("placeholder", "openai/whisper-large-v3");
        fireEvent.click(screen.getByRole("button", { name: /Transcribe$/ }));
        await screen.findByText("Hello from a synthetic recording.");
        expect(f.mock.calls[0][0]).toBe("https://api.together.xyz/v1/audio/transcriptions");
        expect((f.mock.calls[0][1]!.body as FormData).get("model")).toBe("openai/whisper-large-v3");
    });

    it("lists only the providers that can transcribe in its key panel", () => {
        // The panel listed Anthropic and Gemini first and DeepSeek under
        // "Explore all", and the page refused each only after it was picked.
        startWithKey("openai");
        const offers = panel.props?.offers;
        expect(offers).toBeTypeOf("function");
        expect(PROVIDERS.filter(p => offers!(p)).map(p => p.id))
            .toEqual(["openai", "openrouter", "groq", "together", "mistral", "openai-compatible"]);
    });

    it("does not offer DeepSeek, which has no transcription endpoint, and sends nothing", () => {
        const f = vi.spyOn(globalThis, "fetch");
        startWithKey("deepseek");
        expect(screen.getByText(/DeepSeek has no transcription API — pick OpenAI, OpenRouter, Groq, Together AI, Mistral or a self-hosted endpoint\./)).toBeInTheDocument();
        expect(screen.queryByLabelText("Model (optional)")).toBeNull();
        expect(screen.getByRole("button", { name: /Transcribe$/ })).toBeDisabled();
        expect(f).not.toHaveBeenCalled();
    });
});
