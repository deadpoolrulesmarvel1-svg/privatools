import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as db from "@/lib/localStore/db";
import * as counters from "@/lib/localStore/counters";
import { BatesCounterPicker } from "./BatesCounterPicker";

beforeEach(async () => {
  await db.destroy();
});

describe("BatesCounterPicker", () => {
  it("offers to create a matter when none exist", async () => {
    render(<BatesCounterPicker onActivate={vi.fn()} />);
    expect(await screen.findByText(/new matter/i)).toBeInTheDocument();
    expect(await screen.findByText(/keep numbering continuous/i)).toBeInTheDocument();
  });

  it("shows each matter with its next number", async () => {
    await counters.createCounter({ name: "Smith v. Acme", prefix: "SMITH-", next: 412 });
    render(<BatesCounterPicker onActivate={vi.fn()} />);
    expect(await screen.findByText("Smith v. Acme")).toBeInTheDocument();
    expect(await screen.findByText("SMITH-000412")).toBeInTheDocument();
  });

  it("announces the active counter on mount", async () => {
    const created = await counters.createCounter({ name: "M", prefix: "M-", next: 7 });
    const onActivate = vi.fn();
    render(<BatesCounterPicker onActivate={onActivate} />);
    await waitFor(() =>
      expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: created.id, next: 7 })),
    );
  });

  it("announces null when there are no matters", async () => {
    const onActivate = vi.fn();
    render(<BatesCounterPicker onActivate={onActivate} />);
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith(null));
  });

  it("creates a matter and makes it active", async () => {
    const onActivate = vi.fn();
    render(<BatesCounterPicker onActivate={onActivate} />);
    await userEvent.click(await screen.findByText(/new matter/i));
    await userEvent.type(screen.getByLabelText(/matter name/i), "Jones v. Beta");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText("Jones v. Beta")).toBeInTheDocument();
    await waitFor(async () =>
      expect(await counters.getActiveCounterId()).toBe((await counters.listCounters())[0].id),
    );
  });

  it("switches the active matter", async () => {
    const a = await counters.createCounter({ name: "A", prefix: "A-" });
    const b = await counters.createCounter({ name: "B", prefix: "B-" });
    const onActivate = vi.fn();
    render(<BatesCounterPicker onActivate={onActivate} />);

    await userEvent.click(await screen.findByText("B"));
    await waitFor(async () => expect(await counters.getActiveCounterId()).toBe(b.id));
    expect(a.id).toBeTruthy();
  });

  it("does not create a matter with a blank name", async () => {
    render(<BatesCounterPicker onActivate={vi.fn()} />);
    await userEvent.click(await screen.findByText(/new matter/i));
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await counters.listCounters()).toEqual([]);
  });
});
