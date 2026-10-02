import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConsumerSearch } from "./ConsumerChrome";
import { searchTools } from "./catalogue";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("tool search dialog", () => {
    it("announces how many results a query found once typing settles", () => {
        vi.useFakeTimers();
        render(<ConsumerSearch open onOpenChange={vi.fn()} history={[]} />);
        const status = document.querySelector<HTMLElement>(".sr-only[role=status]")!;
        expect(status).toHaveTextContent("");
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "compress" } });
        // Not on every keystroke: the count waits for a pause.
        expect(status).toHaveTextContent("");
        act(() => { vi.advanceTimersByTime(400); });
        const shown = Math.min(searchTools("compress").length, 9);
        expect(status).toHaveTextContent(`${shown} result${shown === 1 ? "" : "s"}`);
        expect(screen.getAllByRole("option")).toHaveLength(shown);
    });

    it("never repeats the last search's count when the dialog is reopened", () => {
        vi.useFakeTimers();
        const view = render(<ConsumerSearch open onOpenChange={vi.fn()} history={[]} />);
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "compress" } });
        act(() => { vi.advanceTimersByTime(400); });
        expect(document.querySelector(".sr-only[role=status]")).not.toHaveTextContent(/^$/);
        view.rerender(<ConsumerSearch open={false} onOpenChange={vi.fn()} history={[]} />);
        view.rerender(<ConsumerSearch open onOpenChange={vi.fn()} history={[]} />);
        // Straight after reopening, and once the reset query has settled.
        expect(document.querySelector(".sr-only[role=status]")).toHaveTextContent(/^$/);
        act(() => { vi.advanceTimersByTime(400); });
        expect(document.querySelector(".sr-only[role=status]")).toHaveTextContent(/^$/);
    });

    it("leaves a query with no match to the visible no-match status", () => {
        vi.useFakeTimers();
        render(<ConsumerSearch open onOpenChange={vi.fn()} history={[]} />);
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzqqxx" } });
        act(() => { vi.advanceTimersByTime(400); });
        expect(screen.getByText(/No match for/)).toHaveAttribute("role", "status");
        expect(document.querySelector(".sr-only[role=status]")).toHaveTextContent("");
    });

    it("gives the placeholder the muted ink instead of the browser's pale grey", () => {
        const css = readFileSync(join(process.cwd(), "src/skins/daylight/consumer/consumer.css"), "utf8");
        expect(css).toMatch(/\.cp-search-input input::placeholder \{color:hsl\(var\(--muted-foreground\)\);opacity:1;\}/);
    });
});
