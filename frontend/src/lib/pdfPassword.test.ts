import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "./localStore/db";
import * as crypt from "./localStore/crypto";
import * as vault from "./localStore/vault";
import { trialVaultPasswords } from "./pdfPassword";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

const passwordError = () =>
  Object.assign(new Error("password required"), { name: "PasswordException" });

describe("trialVaultPasswords", () => {
  it("returns notNeeded when the document opens without a password", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const res = await trialVaultPasswords(new Uint8Array([1]), open);
    expect(res).toEqual({ status: "notNeeded" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("tries newest-first when nothing has been used yet", async () => {
    await vault.addPassword("older", "aaa");
    await vault.addPassword("newer", "bbb");

    const order: (string | undefined)[] = [];
    const open = vi.fn(async (_data: Uint8Array, password?: string) => {
      order.push(password);
      throw passwordError();
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    // First call is the no-password probe; candidates follow, newest first.
    expect(order).toEqual([undefined, "bbb", "aaa"]);
  });

  it("prefers the most recently USED password over the most recent", async () => {
    const older = await vault.addPassword("older", "aaa");
    await vault.addPassword("newer", "bbb");
    await vault.markUsed(older.id);

    const order: (string | undefined)[] = [];
    const open = vi.fn(async (_data: Uint8Array, password?: string) => {
      order.push(password);
      throw passwordError();
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    expect(order).toEqual([undefined, "aaa", "bbb"]);
  });

  it("finds the matching password and reports how many were tried", async () => {
    await vault.addPassword("wrong", "aaa");
    await vault.addPassword("right", "bbb");
    const b = (await vault.listEntries()).find((e) => e.label === "right")!;

    const open = vi.fn(async (_data: Uint8Array, password?: string) => {
      if (password !== "bbb") throw passwordError();
      return "ok";
    });

    // "right" was saved last, so with no usage history it is tried first.
    const res = await trialVaultPasswords(new Uint8Array([1]), open);
    expect(res).toEqual({ status: "unlocked", password: "bbb", entryId: b.id, tried: 1 });
  });

  it("marks the winning entry as used", async () => {
    await vault.addPassword("right", "bbb");
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "bbb") throw passwordError();
      return "ok";
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    expect((await vault.listEntries())[0].useCount).toBe(1);
  });

  it("reports needed when no saved password fits", async () => {
    await vault.addPassword("a", "aaa");
    const open = vi.fn(async () => {
      throw passwordError();
    });
    expect(await trialVaultPasswords(new Uint8Array([1]), open)).toEqual({
      status: "needed",
      tried: 1,
    });
  });

  it("reports needed with tried=0 when the vault is empty", async () => {
    const open = vi.fn(async () => {
      throw passwordError();
    });
    expect(await trialVaultPasswords(new Uint8Array([1]), open)).toEqual({
      status: "needed",
      tried: 0,
    });
  });

  it("propagates a non-password error instead of masking it as needed", async () => {
    const open = vi.fn(async () => {
      throw Object.assign(new Error("corrupt"), { name: "InvalidPDFException" });
    });
    await expect(trialVaultPasswords(new Uint8Array([1]), open)).rejects.toThrow(/corrupt/);
  });

  it("stops at the first match without trying the rest", async () => {
    await vault.addPassword("a", "aaa");
    await vault.addPassword("b", "bbb");
    const tried: (string | undefined)[] = [];
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      tried.push(password);
      if (password === undefined) throw passwordError();
      return "ok";
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    // one probe with no password, then exactly one candidate
    expect(tried).toHaveLength(2);
  });

  // This is the security property the whole vault design rests on. If anyone
  // refactors the trial to ask the server "does this password work?", this
  // must fail loudly.
  it("never performs a network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await vault.addPassword("a", "aaa");
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "aaa") throw passwordError();
      return "ok";
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
