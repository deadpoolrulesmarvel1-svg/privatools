/**
 * Smart Redact's copy has a harder job than Summarize PDF's.
 *
 * By definition this document contains the personal information the user is
 * trying to remove, so "send it to a third party" is a genuinely consequential
 * choice rather than a convenience one. The UI has to say that plainly, and it
 * also has to say what is actually protected — the values the regex pass found
 * are masked before anything is sent — without letting that reassurance blur
 * the fact that the rest of the text does go.
 *
 * These tests pin both halves. Copy that oversells is how a user makes a
 * decision they would not have made with the facts.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { SmartRedactUI } from "./SmartRedactUI";

beforeEach(async () => {
  _resetForTests();
  await db.clear("secrets");
  localStorage.clear();
});

async function mountAndPick() {
  const { container } = render(
    <TooltipProvider>
      <SmartRedactUI />
    </TooltipProvider>,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(
    input,
    new File([new Blob(["%PDF-1.4\n%%EOF"])], "doc.pdf", { type: "application/pdf" }),
  );
  await waitFor(() =>
    expect(screen.getByText(/how to find names and organisations/i)).toBeInTheDocument(),
  );
  return container;
}

describe("SmartRedactUI privacy copy", () => {
  it("defaults to the on-device model", async () => {
    await mountAndPick();
    expect(screen.getByText(/nothing leaves this tab/i)).toBeInTheDocument();
  });

  it("says pattern detection is local either way, so the choice is scoped honestly", async () => {
    await mountAndPick();
    expect(screen.getByText(/no model, no network, either way/i)).toBeInTheDocument();
  });

  it("warns that this document is the sensitive one, before any key is entered", async () => {
    await mountAndPick();
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() =>
      expect(
        screen.getByText(/contains the personal information you are trying\s+to remove/i),
      ).toBeInTheDocument(),
    );
  });

  it("states what is masked AND that the rest is sent intact", async () => {
    await mountAndPick();
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      expect(screen.getByText(/replaced with\s+placeholders before the text is sent/i)).toBeInTheDocument();
      // The reassurance must not be allowed to imply nothing is sent.
      expect(screen.getByText(/remaining text is sent intact/i)).toBeInTheDocument();
    });
  });

  it("marks which engine is actually selected, so the other option's blurb cannot be misread", async () => {
    // "Nothing leaves this tab" legitimately stays on screen after switching:
    // it is the ON-DEVICE button's own label, describing the alternative. The
    // thing that must be unambiguous is which one is active, so a glance at
    // the wrong blurb is not the only signal available.
    await mountAndPick();
    const local = screen.getByText(/nothing leaves this tab/i).closest("button")!;
    const byokBtn = screen.getByText(/my own api key/i).closest("button")!;
    expect(local).toHaveAttribute("aria-pressed", "true");
    expect(byokBtn).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(byokBtn);
    await waitFor(() => {
      expect(byokBtn).toHaveAttribute("aria-pressed", "true");
      expect(local).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("puts the warning on screen at the same time as the key field", async () => {
    // The warning is what carries the meaning of the choice. It must not be
    // reachable only by scrolling past the input someone is about to fill in.
    await mountAndPick();
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      const warning = screen.getByText(/contains the personal information you are trying\s+to remove/i);
      const panel = screen.getByText(/use your own ai key/i);
      expect(warning).toBeInTheDocument();
      expect(panel).toBeInTheDocument();
      // Warning must come BEFORE the panel in document order.
      expect(warning.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
