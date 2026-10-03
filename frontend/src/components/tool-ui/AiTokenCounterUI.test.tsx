/**
 * The AI Token Counter page: what it counts, what it sends and to whom.
 * Inputs are synthetic; every provider answer is a mock and every key a
 * dummy. A request no test expects fails the test.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { listConfigured, saveKey } from "@/lib/byok/keyStore";
import { formatCost } from "@/lib/tokens/cost";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), downloadBlob: mocks.download }));
import { AiTokenCounterUI } from "./AiTokenCounterUI";

const RUN_EVENT = "privatools:tool-run";
const DUMMY_KEY = "sk-ant-dummy-key-for-tests-000";
const SLOW = { timeout: 20000 };

let runs: Array<Record<string, unknown>> = [];
const listen = (event: Event) => runs.push((event as CustomEvent).detail);
let network: ReturnType<typeof vi.fn>;
let clipboard: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    _resetForTests();
    await db.clear("secrets");
    localStorage.clear();
    runs = [];
    window.addEventListener(RUN_EVENT, listen);
    mocks.download.mockReset();
    // Nothing leaves the tab unless a test says so.
    network = vi.fn(async () => { throw new Error("unexpected network request"); });
    vi.stubGlobal("fetch", network);
    clipboard = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
});
afterEach(() => {
    window.removeEventListener(RUN_EVENT, listen);
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const paste = (value: string) => fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value } });
const countButton = () => screen.getByRole("button", { name: /Count tokens/ });
const row = (name: RegExp) => screen.getAllByRole("listitem").find(item => name.test(item.querySelector(".atc-count-name")?.textContent ?? ""))!;

function anthropicAnswers(status: number, body: unknown) {
    network.mockImplementation(async () => ({
        ok: status >= 200 && status < 300, status,
        json: async () => body, text: async () => JSON.stringify(body),
    }) as unknown as Response);
}

describe("counting on the device", () => {
    it("counts pasted text exactly for both GPT encodings and sends nothing anywhere", async () => {
        render(<AiTokenCounterUI />);
        expect(countButton()).toBeDisabled();
        paste("   \n ");
        expect(countButton()).toBeDisabled();
        paste("tiktoken is great!");
        expect(countButton()).toBeEnabled();
        fireEvent.click(countButton());
        expect(await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW)).toBeInTheDocument();
        expect(screen.getByText("18 characters and 3 words, read on this device.")).toBeInTheDocument();
        // OpenAI's tiktoken gives 6 tokens in each.
        expect(within(row(/o200k_base/)).getByText("6 tokens")).toBeInTheDocument();
        expect(within(row(/cl100k_base/)).getByText("6 tokens")).toBeInTheDocument();
        expect(within(row(/o200k_base/)).getByText("Exact. Counted on this device.")).toBeInTheDocument();
        // No bare number for Claude or Gemini without a key.
        for (const [family, company] of [["Claude", "Anthropic"], ["Gemini", "Google"]]) {
            const item = row(new RegExp(`^${family}`));
            expect(within(item).getByText("No count")).toBeInTheDocument();
            expect(item).toHaveTextContent(`An exact ${family} count needs your ${company} key. This page doesn’t guess one.`);
            expect(item.textContent).not.toMatch(/\d/);
        }
        expect(network).not.toHaveBeenCalled();
        expect(runs).toEqual([{ outcome: "success" }]);
    });

    it("names only models gpt-tokenizer maps to each encoding", async () => {
        render(<AiTokenCounterUI />);
        paste("hello world");
        fireEvent.click(countButton());
        await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW);
        expect(row(/o200k_base/)).toHaveTextContent("GPT-5.5, GPT-5, GPT-4.1, GPT-4o, o4-mini, o3 and o1 o200k_base");
        expect(row(/cl100k_base/)).toHaveTextContent("GPT-4, GPT-4 Turbo and GPT-3.5 Turbo cl100k_base");
    });

    it("reads a chosen file only when asked to count, and counts its text", async () => {
        const { container } = render(<AiTokenCounterUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File(["hello world"], "notes.md", { type: "text/markdown" })] } });
        expect(screen.getByText("notes.md")).toBeInTheDocument();
        expect(screen.queryByLabelText("Or paste text")).toBeNull();
        fireEvent.click(countButton());
        expect(await screen.findByRole("heading", { name: "Token counts for notes.md" }, SLOW)).toBeInTheDocument();
        expect(within(row(/o200k_base/)).getByText("2 tokens")).toBeInTheDocument();
        expect(network).not.toHaveBeenCalled();
        expect(runs).toEqual([{ outcome: "success", files: 1 }]);
    });

    it("says why a file can't be counted, offers another, and sends nothing", async () => {
        const { container } = render(<AiTokenCounterUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File([strToU8("not a zip at all")], "report.docx")] } });
        fireEvent.click(countButton());
        expect(await screen.findByRole("heading", { name: "This file couldn’t be counted." }, SLOW)).toBeInTheDocument();
        expect(screen.getByText(/report\.docx couldn't be read as a Word document/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
        expect(network).not.toHaveBeenCalled();
        expect(runs).toEqual([{ outcome: "error", files: 1, errorKind: "bad_input" }]);
        fireEvent.click(screen.getByRole("button", { name: "Back to the form" }));
        expect(await screen.findByRole("button", { name: /Count tokens/ })).toBeEnabled();
    });

    it("says an empty file is empty", async () => {
        const { container } = render(<AiTokenCounterUI />);
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [new File([""], "blank.txt", { type: "text/plain" })] } });
        fireEvent.click(countButton());
        expect(await screen.findByText("blank.txt is empty.", undefined, SLOW)).toBeInTheDocument();
    });
});

describe("Claude and Gemini, with the visitor's own key", () => {
    it("never asks a provider whose box is not ticked, even with a key saved", async () => {
        await saveKey("anthropic", DUMMY_KEY);
        render(<AiTokenCounterUI />);
        expect(await screen.findByText(/Key saved on this device/)).toBeInTheDocument();
        const ask = screen.getByRole("checkbox", { name: /Count with Claude/ });
        expect(ask).not.toBeChecked();
        paste("A short prompt.");
        fireEvent.click(countButton());
        await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW);
        expect(row(/^Claude/)).toHaveTextContent("Not asked.");
        expect(network).not.toHaveBeenCalled();
    });

    it("asks Anthropic for its count when ticked, sends the text as it is, and says how exact it is", async () => {
        await saveKey("anthropic", DUMMY_KEY);
        anthropicAnswers(200, { input_tokens: 1234 });
        render(<AiTokenCounterUI />);
        fireEvent.click(await screen.findByRole("checkbox", { name: /Count with Claude/ }));
        expect(screen.getByLabelText("Model")).toHaveValue("claude-sonnet-5-5");
        const text = "Count me, exactly as I am.\n\tTabs and all.";
        paste(text);
        fireEvent.click(countButton());
        await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW);
        expect(network).toHaveBeenCalledTimes(1);
        const [url, init] = network.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
        expect((init.headers as Record<string, string>)["x-api-key"]).toBe(DUMMY_KEY);
        expect(JSON.parse(init.body as string)).toEqual({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: text }] });
        const claude = row(/^Claude/);
        expect(within(claude).getByText("1,234 tokens")).toBeInTheDocument();
        expect(claude).toHaveTextContent("claude-sonnet-5-5");
        expect(claude).toHaveTextContent("Anthropic calls it an estimate");
        expect(runs).toEqual([{ outcome: "success" }]);
    });

    it("shows a provider's refusal in its row and keeps the GPT counts", async () => {
        await saveKey("anthropic", DUMMY_KEY);
        anthropicAnswers(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
        render(<AiTokenCounterUI />);
        fireEvent.click(await screen.findByRole("checkbox", { name: /Count with Claude/ }));
        paste("tiktoken is great!");
        fireEvent.click(countButton());
        await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW);
        const claude = row(/^Claude/);
        expect(within(claude).getByText("Not counted")).toBeInTheDocument();
        expect(claude).toHaveTextContent("That key was rejected. Check it is correct, still active, and has access to the model you picked.");
        expect(within(row(/o200k_base/)).getByText("6 tokens")).toBeInTheDocument();
        expect(screen.getByText(/A count you asked for didn’t come back; the reason is with it\./)).toBeInTheDocument();
        expect(runs).toEqual([{ outcome: "partial", errorKind: "provider" }]);
        // The key never reaches the page.
        expect(document.body.innerHTML).not.toContain(DUMMY_KEY);
    });

    it("won't count while a ticked provider has no model named", async () => {
        await saveKey("anthropic", DUMMY_KEY);
        render(<AiTokenCounterUI />);
        fireEvent.click(await screen.findByRole("checkbox", { name: /Count with Claude/ }));
        paste("Some text.");
        expect(countButton()).toBeEnabled();
        fireEvent.change(screen.getByLabelText("Model"), { target: { value: "  " } });
        expect(countButton()).toBeDisabled();
        expect(screen.getByText("Enter the model to count for.")).toBeInTheDocument();
        expect(network).not.toHaveBeenCalled();
    });

    it("saves a key typed here, ticks that provider, and removes it again", async () => {
        render(<AiTokenCounterUI />);
        const field = screen.getByLabelText("Google AI Studio API key");
        expect(field).toHaveAttribute("type", "password");
        fireEvent.change(field, { target: { value: "AIzaDummyKeyForTests0000000000000" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Save key" })[1]);
        expect(await screen.findByRole("checkbox", { name: /Count with Gemini/ })).toBeChecked();
        expect(await listConfigured()).toEqual(["gemini"]);
        expect(document.body.innerHTML).not.toContain("AIzaDummyKeyForTests");
        fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
        expect(await screen.findByLabelText("Google AI Studio API key")).toBeInTheDocument();
        expect(await listConfigured()).toEqual([]);
    });
});

describe("cost and chunks", () => {
    it("works out a cost only from prices the visitor enters", async () => {
        render(<AiTokenCounterUI />);
        paste("tiktoken is great!");
        fireEvent.click(countButton());
        await screen.findByRole("heading", { name: "Token counts for your text" }, SLOW);
        const sums = () => [...document.querySelectorAll(".atc-cost-sums dd")].map(dd => dd.textContent);
        expect(sums()).toEqual(["—", "—", "—"]);
        fireEvent.change(screen.getByLabelText("Input price, $ per 1M tokens"), { target: { value: "2.50" } });
        fireEvent.change(screen.getByLabelText("Output price, $ per 1M tokens"), { target: { value: "10" } });
        fireEvent.change(screen.getByLabelText("Output tokens you expect"), { target: { value: "1000" } });
        expect(sums()).toEqual([formatCost(6 * 2.5 / 1e6), formatCost(0.01), formatCost(6 * 2.5 / 1e6 + 0.01)]);
        expect(sums()[0]).toBe("$0.000015");
        fireEvent.change(screen.getByLabelText("Input price, $ per 1M tokens"), { target: { value: "abc" } });
        expect(screen.getByText("Enter a number, such as 2.50.")).toBeInTheDocument();
    });

    it("splits text into chunks within the size, copies one and downloads them all", async () => {
        render(<AiTokenCounterUI />);
        fireEvent.click(screen.getByRole("checkbox", { name: "Split the text into chunks of GPT tokens" }));
        const size = screen.getByLabelText("Tokens per chunk");
        fireEvent.change(size, { target: { value: "5" } });
        expect(countButton()).toBeDisabled();
        expect(screen.getByText("Enter a whole number from 10 to 1,000,000.")).toBeInTheDocument();
        fireEvent.change(size, { target: { value: "10" } });
        paste(Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" "));
        fireEvent.click(countButton());
        expect(await screen.findByRole("heading", { name: /chunks of at most 10 tokens/ }, SLOW)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Copy chunk 1" }));
        await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
        expect(clipboard.mock.calls[0][0]).toMatch(/^Sentence number 1/);
        fireEvent.click(screen.getByRole("button", { name: /Download all chunks/ }));
        expect(mocks.download).toHaveBeenCalledTimes(1);
        const [blob, name] = mocks.download.mock.calls[0] as [Blob, string];
        expect(name).toBe("text_chunks.txt");
        expect(await blob.text()).toMatch(/^Split into \d+ chunks of at most 10 tokens each, counted with o200k_base\.\n\n===== Chunk 1 of \d+ · \d+ tokens? =====\nSentence number 1/);
        expect(network).not.toHaveBeenCalled();
    });
});
