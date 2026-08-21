import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import * as assets from "@/lib/localStore/assets";
import * as counters from "@/lib/localStore/counters";
import * as defaults from "@/lib/localStore/defaults";
import { savePersisted } from "@/lib/persistence";
import MyStuffPage from "./MyStuffPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyStuffPage />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
  localStorage.clear();
});

describe("MyStuffPage", () => {
  it("states that storage is device-local", async () => {
    renderPage();
    expect(await screen.findByText(/stored on this device only/i)).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    renderPage();
    expect(await screen.findByText(/nothing stored on this device/i)).toBeInTheDocument();
  });

  it("lists what is stored", async () => {
    await vault.addPassword("work docs", "hunter2");
    await counters.createCounter({ name: "Smith v. Acme", prefix: "SMITH-", next: 412 });
    await assets.putAsset("signature", "sig.png", new Blob([new Uint8Array(2048)]));
    savePersisted("compress-pdf", { level: "extreme" });
    await defaults.registerCustomized("compress-pdf");

    renderPage();
    expect(await screen.findByText(/1 password/i)).toBeInTheDocument();
    expect(await screen.findByText("SMITH-000412")).toBeInTheDocument();
    expect(await screen.findByText(/1 tool customized/i)).toBeInTheDocument();
  });

  it("never renders a stored password", async () => {
    await vault.addPassword("work docs", "hunter2");
    renderPage();
    await screen.findByText(/1 password/i);
    expect(document.body.textContent).not.toContain("hunter2");
  });

  it("warns about unreadable vault entries", async () => {
    await db.put("vault", "corrupt", {
      id: "corrupt",
      label: "broken",
      iv: new Uint8Array(12),
      ct: new Uint8Array([1, 2, 3]).buffer,
      createdAt: 1,
      lastUsedAt: 0,
      useCount: 0,
    });
    renderPage();
    expect(await screen.findByText(/can't be read/i)).toBeInTheDocument();
  });

  it("does not overclaim about what encryption protects", async () => {
    await vault.addPassword("work docs", "hunter2");
    renderPage();
    await screen.findByText(/1 password/i);
    // Must be honest that this is not protection against a compromised page.
    expect(screen.getByText(/casual access/i)).toBeInTheDocument();
  });

  it("says the export excludes the vault", async () => {
    renderPage();
    expect(await screen.findByText(/excludes.*vault|vault.*not included/i)).toBeInTheDocument();
  });

  it("requires confirmation before erasing", async () => {
    await vault.addPassword("work docs", "hunter2");
    renderPage();
    await screen.findByText(/1 password/i);

    await userEvent.click(screen.getByRole("button", { name: /erase everything/i }));
    // Not erased yet — a confirmation must appear first.
    expect(await vault.listEntries()).toHaveLength(1);
    expect(await screen.findByRole("button", { name: /^yes, erase/i })).toBeInTheDocument();
  });

  it("erases everything when confirmed", async () => {
    await vault.addPassword("work docs", "hunter2");
    await counters.createCounter({ name: "M" });
    renderPage();
    await screen.findByText(/1 password/i);

    await userEvent.click(screen.getByRole("button", { name: /erase everything/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^yes, erase/i }));

    await waitFor(async () => {
      expect(await vault.listEntries()).toEqual([]);
    });
    expect(await screen.findByText(/nothing stored on this device/i)).toBeInTheDocument();
  });
});
