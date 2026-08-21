/**
 * The privacy copy on this page must track the engine actually selected.
 *
 * Before BYOK existed, the banner said "Your PDF never leaves this tab …
 * no AI APIs (OpenAI, Anthropic)" unconditionally. That claim stopped being
 * true the moment a user could pick their own provider — and it renders
 * directly above the control that picks one.
 *
 * A stale privacy claim sitting next to the thing that contradicts it is
 * worse than no claim, because the whole product asks to be trusted on
 * exactly this point. These tests exist so the copy cannot quietly drift back.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { SummarizePdfUI } from "./SummarizePdfUI";

beforeEach(async () => {
  _resetForTests();
  await db.clear("secrets");
  localStorage.clear();
});

function mount() {
  return render(
    <TooltipProvider>
      <SummarizePdfUI />
    </TooltipProvider>,
  );
}

async function pickAFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Blob(["%PDF-1.4\n%%EOF"])], "doc.pdf", { type: "application/pdf" });
  await userEvent.upload(input, file);
  await waitFor(() => expect(screen.getByText(/which model/i)).toBeInTheDocument());
}

describe("SummarizePdfUI privacy copy", () => {
  it("claims nothing leaves the tab while the on-device model is selected", async () => {
    const { container } = mount();
    await pickAFile(container);
    expect(screen.getByText(/never leaves this tab/i)).toBeInTheDocument();
  });

  it("drops that claim once the user's own key is selected", async () => {
    const { container } = mount();
    await pickAFile(container);
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      expect(screen.queryByText(/never leaves this tab/i)).not.toBeInTheDocument();
    });
  });

  it("says where the file actually goes in BYOK mode", async () => {
    const { container } = mount();
    await pickAFile(container);
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      expect(screen.getByText(/does not pass through PrivaTools/i)).toBeInTheDocument();
    });
  });

  it("names whose terms apply, rather than implying ours still do", async () => {
    const { container } = mount();
    await pickAFile(container);
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      expect(screen.getByText(/their terms and retention policy apply/i)).toBeInTheDocument();
    });
  });

  it("offers the way back to fully-local processing", async () => {
    const { container } = mount();
    await pickAFile(container);
    await userEvent.click(screen.getByText(/my own api key/i));
    await waitFor(() => {
      expect(screen.getByText(/rather nothing left this tab/i)).toBeInTheDocument();
    });
  });

  it("defaults to the on-device model, so BYOK is opt-in", async () => {
    const { container } = mount();
    await pickAFile(container);
    expect(screen.getByText(/never leaves this tab/i)).toBeInTheDocument();
  });
});
