import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { saveKey } from "@/lib/byok/keyStore";
import { ChatPdfUI } from "./ChatPdfUI";

vi.mock("pdfjs-dist", () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "The pumps are inspected on the first Monday of each month." }] }) }),
            destroy: async () => {},
        }),
    }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

const DUMMY_KEY = "sk-dummy-key-for-tests";

/** A provider that answers the way the real one did to a dummy key on
 *  2026-09-28: 401 at its documented endpoint, 404 at any other address. */
function fakeProvider(endpoint: string) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
        const known = String(input) === endpoint;
        const body = known ? JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } }) : "<!DOCTYPE html><title>Not found</title>";
        return {
            ok: false,
            status: known ? 401 : 404,
            headers: new Headers({ "content-type": known ? "application/json" : "text/html" }),
            json: async () => JSON.parse(body),
            text: async () => body,
        } as unknown as Response;
    });
}

async function askWith(providerId: string) {
    localStorage.setItem("privatools.byok.provider", providerId);
    await saveKey(providerId, DUMMY_KEY);
    const { container } = render(<ChatPdfUI />);
    const file = new File(["%PDF-1.4"], "notice.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
    const question = screen.getByLabelText("Question about your PDF");
    await waitFor(() => expect(question).toBeEnabled());
    fireEvent.change(question, { target: { value: "When are the pumps inspected?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    return screen.findByRole("alert");
}

beforeEach(async () => {
    // jsdom lays nothing out, so it has no scrollTo for the conversation to call.
    Element.prototype.scrollTo = () => {};
    _resetForTests();
    await db.clear("secrets");
    localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Chat with PDF through Groq and OpenRouter", () => {
    it.each([
        ["groq", "https://api.groq.com/openai/v1/chat/completions"],
        ["openrouter", "https://openrouter.ai/api/v1/chat/completions"],
    ])("sends the question to %s's documented endpoint, so a bad key is reported as a bad key", async (providerId, endpoint) => {
        const fetch = fakeProvider(endpoint);
        const alert = await askWith(providerId);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0][0])).toBe(endpoint);
        expect(alert).toHaveTextContent("That key was rejected");
        expect(alert).not.toHaveTextContent(DUMMY_KEY);
    });

    it("does not report a request the browser blocked as a PrivaTools outage", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
        const alert = await askWith("groq");
        expect(alert).toHaveTextContent("The browser blocked the request to Groq");
        expect(alert).not.toHaveTextContent("Couldn't reach the server");
    });
});
