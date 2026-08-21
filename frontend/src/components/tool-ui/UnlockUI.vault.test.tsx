/**
 * UnlockUI × vault wiring.
 *
 * pdf.js is mocked at the opener seam so no worker loads in jsdom. The real
 * trial logic (ordering, exhaustion, markUsed) is covered by
 * lib/pdfPassword.test.ts; this file only proves the tool is wired to it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";

const openMock = vi.fn();

vi.mock("@/lib/pdfPassword", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdfPassword")>();
  return { ...actual, makePdfJsOpener: async () => openMock };
});

import { UnlockUI } from "./UnlockUI";

const passwordError = () =>
  Object.assign(new Error("password required"), { name: "PasswordException" });

const pdfFile = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "secret.pdf", {
    type: "application/pdf",
  });

async function drop(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, file);
}

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
  openMock.mockReset();
});

describe("UnlockUI vault integration", () => {
  it("prefills the password when a saved one fits", async () => {
    await vault.addPassword("work docs", "hunter2");
    openMock.mockImplementation(async (_d: Uint8Array, password?: string) => {
      if (password !== "hunter2") throw passwordError();
      return "ok";
    });

    render(<UnlockUI />);
    await drop(pdfFile());

    expect(await screen.findByText(/unlocked with a saved password/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/enter the existing password/i) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("hunter2"));
  });

  it("asks for a password when none of the saved ones fit", async () => {
    await vault.addPassword("wrong one", "nope");
    openMock.mockImplementation(async () => {
      throw passwordError();
    });

    render(<UnlockUI />);
    await drop(pdfFile());

    expect(await screen.findByText(/none of your 1 saved password/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/enter the existing password/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("says nothing about the vault for an unencrypted PDF", async () => {
    openMock.mockResolvedValue("ok");
    render(<UnlockUI />);
    await drop(pdfFile());

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/enter the existing password/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/saved password/i)).not.toBeInTheDocument();
  });

  it("prompts for the password with an empty vault, without claiming to have tried any", async () => {
    openMock.mockImplementation(async () => {
      throw passwordError();
    });
    render(<UnlockUI />);
    await drop(pdfFile());

    expect(await screen.findByText(/this pdf is password-protected/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved password/i)).not.toBeInTheDocument();
  });

  it("never sends a wrong candidate anywhere — no network during the trial", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await vault.addPassword("a", "aaa");
    await vault.addPassword("b", "bbb");
    openMock.mockImplementation(async (_d: Uint8Array, password?: string) => {
      if (password !== "bbb") throw passwordError();
      return "ok";
    });

    render(<UnlockUI />);
    await drop(pdfFile());
    await screen.findByText(/unlocked with a saved password/i);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
