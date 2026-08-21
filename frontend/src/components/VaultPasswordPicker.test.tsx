import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import { VaultPasswordPicker } from "./VaultPasswordPicker";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

describe("VaultPasswordPicker", () => {
  it("renders nothing when the vault is empty", async () => {
    const { container } = render(<VaultPasswordPicker onPick={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists labels but never passwords", async () => {
    await vault.addPassword("work docs", "hunter2");
    render(<VaultPasswordPicker onPick={vi.fn()} />);
    expect(await screen.findByText("work docs")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("hunter2");
  });

  it("passes the decrypted password to onPick only when chosen", async () => {
    await vault.addPassword("work docs", "hunter2");
    const onPick = vi.fn();
    render(<VaultPasswordPicker onPick={onPick} />);
    await userEvent.click(await screen.findByText("work docs"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("hunter2"));
  });

  it("lists every saved entry", async () => {
    await vault.addPassword("one", "a");
    await vault.addPassword("two", "b");
    render(<VaultPasswordPicker onPick={vi.fn()} />);
    expect(await screen.findByText("one")).toBeInTheDocument();
    expect(await screen.findByText("two")).toBeInTheDocument();
  });
});
