/**
 * How the AI Token Counter fails on pasted text: a part of the page that
 * didn't download (retryable), and text over the page's limit (not).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TEXT_CHARS } from "@/lib/tokens/extract";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/tokens/encoders", async original => ({ ...await original<object>(), loadGptEncoder: mocks.load }));
import { AiTokenCounterUI } from "./AiTokenCounterUI";

let runs: Array<Record<string, unknown>> = [];
const listen = (event: Event) => runs.push((event as CustomEvent).detail);
beforeEach(() => {
    runs = [];
    window.addEventListener("privatools:tool-run", listen);
    mocks.load.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network request"); }));
});
afterEach(() => { window.removeEventListener("privatools:tool-run", listen); cleanup(); vi.unstubAllGlobals(); });

const paste = (value: string) => fireEvent.change(screen.getByLabelText("Or paste text"), { target: { value } });

describe("when pasted text can't be counted", () => {
    it("says a part of the page didn't download, offers another try, and leads back to the text", async () => {
        mocks.load.mockRejectedValue(new TypeError("Failed to fetch dynamically imported module: /assets/o200k_base-x.js"));
        render(<AiTokenCounterUI />);
        paste("Some text to count.");
        fireEvent.click(screen.getByRole("button", { name: /Count tokens/ }));
        expect(await screen.findByRole("heading", { name: "This text couldn’t be counted." })).toBeInTheDocument();
        expect(screen.getByText("Part of this page couldn’t be downloaded, so the count didn’t run. Check that this device is online, then try again.")).toBeInTheDocument();
        expect(screen.getByText(/Nothing was counted\. The connection dropped\./)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Choose/ })).toBeNull();
        expect(runs).toEqual([{ outcome: "error", errorKind: "network" }]);
        fireEvent.click(screen.getByRole("button", { name: "Back to the text" }));
        expect(await screen.findByLabelText("Or paste text")).toHaveValue("Some text to count.");
    });

    it("refuses text over the limit before loading anything, and offers no retry", async () => {
        render(<AiTokenCounterUI />);
        paste("x".repeat(MAX_TEXT_CHARS + 1));
        fireEvent.click(screen.getByRole("button", { name: /Count tokens/ }));
        expect(await screen.findByText(/This text is more than 20 million characters/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(mocks.load).not.toHaveBeenCalled();
        expect(runs).toEqual([{ outcome: "error", errorKind: "too_large" }]);
    });
});
