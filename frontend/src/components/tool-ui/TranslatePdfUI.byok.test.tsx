import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { saveKey } from "@/lib/byok/keyStore";
import { TOOL_RUN_EVENT } from "@/lib/toolRun";
import { TranslatePdfUI } from "./TranslatePdfUI";

vi.mock("pdfjs-dist", () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "The pumps are inspected on the first Monday of each month." }] }) }),
        }),
    }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "worker.js" }));
/** The real key store, except that a saved key can be made unreadable. */
const keys = vi.hoisted(() => ({ unreadable: false }));
vi.mock("@/lib/byok/keyStore", async importOriginal => {
    const real = await importOriginal<typeof import("@/lib/byok/keyStore")>();
    return { ...real, getKey: async (id: string) => (keys.unreadable ? undefined : real.getKey(id)) };
});

const DUMMY_KEY = "dummy-key-for-tests";
const TRANSLATION = "Les pompes sont inspectées le premier lundi de chaque mois.";

const OPENAI_SHAPED: Record<string, string> = {
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    together: "https://api.together.xyz/v1/chat/completions",
};
const GEMINI = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([^:]+):generateContent$/;

/** Models each provider serves, per its documentation on 2026-09-28. */
const SERVED: Record<string, string[]> = {
    gemini: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    deepseek: ["deepseek-flash", "deepseek-v4-pro"],
    openrouter: ["openrouter/auto", "openrouter/free"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
};

/** How each one refuses a model it does not serve, in the shape its API uses. */
const NO_SUCH_MODEL: Record<string, (model: string) => [number, unknown]> = {
    gemini: model => [404, { error: { code: 404, message: `models/${model} is not found for API version v1beta, or is not supported for generateContent.`, status: "NOT_FOUND" } }],
    deepseek: () => [400, { error: { message: "Model Not Exist", type: "invalid_request_error", param: null, code: "invalid_request_error" } }],
    openrouter: model => [400, { error: { message: `${model} is not a valid model ID`, code: 400 } }],
    together: model => [404, { error: { message: `Unable to access model ${model}. Please visit https://api.together.ai/models to view the list of supported models.`, type: "invalid_request_error", code: "model_not_available" } }],
};

function reply(status: number, body: unknown): Response {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300, status,
        headers: new Headers({ "content-type": typeof body === "string" ? "text/html" : "application/json" }),
        json: async () => JSON.parse(text), text: async () => text,
    } as unknown as Response;
}

/** The providers as they answer today: a translation from a model they serve. */
function providersToday() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const gemini = GEMINI.exec(url);
        const provider = gemini ? "gemini" : Object.keys(OPENAI_SHAPED).find(id => OPENAI_SHAPED[id] === url);
        if (!provider) return reply(404, "<!DOCTYPE html><title>Not found</title>");
        const model = gemini ? decodeURIComponent(gemini[1]) : JSON.parse(String(init?.body)).model;
        if (!SERVED[provider].includes(model)) return reply(...NO_SUCH_MODEL[provider](model));
        return reply(200, gemini
            ? { candidates: [{ content: { parts: [{ text: TRANSLATION }] } }] }
            : { choices: [{ message: { content: TRANSLATION } }] });
    });
}

async function translateWith(providerId: string) {
    localStorage.setItem("privatools.byok.provider", providerId);
    await saveKey(providerId, DUMMY_KEY);
    const { container } = render(<TranslatePdfUI />);
    const file = new File(["%PDF-1.4"], "notice.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /My own API key/ }));
    const translate = screen.getByRole("button", { name: "Translate" });
    await waitFor(() => expect(translate).toBeEnabled());
    fireEvent.click(translate);
}

beforeEach(async () => {
    keys.unreadable = false;
    _resetForTests();
    await db.clear("secrets");
    localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Translate PDF says whether the key or PrivaTools is at fault", () => {
    it("reports a Gemini key that Google refuses as a rejected key, though Google answers 400", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(400, { error: {
            code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
            details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }],
        } }));
        await translateWith("gemini");
        expect(await screen.findByRole("alert")).toHaveTextContent("That key was rejected");
    });

    it("counts a saved key it cannot read as the provider set-up, not a browser fault", async () => {
        const runs: unknown[] = [];
        const record = (event: Event) => runs.push((event as CustomEvent).detail);
        window.addEventListener(TOOL_RUN_EVENT, record);
        try {
            keys.unreadable = true;
            const fetch = vi.spyOn(globalThis, "fetch");
            await translateWith("groq");
            expect(await screen.findByRole("alert")).toHaveTextContent("That saved key could not be read");
            expect(fetch).not.toHaveBeenCalled();
            expect(runs).toEqual([{ outcome: "error", files: 1, errorKind: "provider" }]);
        } finally {
            window.removeEventListener(TOOL_RUN_EVENT, record);
        }
    });
});

describe("Translate PDF with your own key and the model box left empty", () => {
    it.each(Object.keys(SERVED))("asks %s for a model it serves, and translates", async providerId => {
        const fetch = providersToday();
        await translateWith(providerId);
        await waitFor(() => expect(screen.queryByText(TRANSLATION) ?? screen.queryByRole("alert")).toBeTruthy());
        expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
        expect(screen.getByText(TRANSLATION)).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
